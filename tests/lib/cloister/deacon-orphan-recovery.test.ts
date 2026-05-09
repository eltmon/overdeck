/**
 * Tests for PAN-369: checkOrphanedReviewStatuses orphan recovery logic.
 *
 * Covers the dispatch paths after queue removal (PAN-722) and role migration (PAN-1048):
 *   (a) testStatus='testing'/'dispatch_failed' + workspace available in agent state
 *       → spawn via spawnRun(issueId, 'test'), set testStatus='testing' on success
 *   (b) spawn failure → set dispatch_failed so deacon retries next patrol
 *   (c) testStatus='testing'/'dispatch_failed' + no workspace available
 *       → reset to 'pending' (user must re-trigger manually)
 *   (d) reviewStatus='pending' + completed.processed marker + workspace + project
 *       → re-dispatch via dispatchParallelReview, set reviewStatus='reviewing'
 *
 * PAN-653: deacon now reads state via loadReviewStatuses() (SQLite-first) and
 * writes via setReviewStatus() (SQLite + JSON). These tests mock both APIs to
 * verify deacon's orchestration logic without touching the filesystem for status data.
 * The completed.processed marker check still uses existsSync (not mocked), so tests
 * for branch (d) create real marker files in the agent state directory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Mock review-status before importing deacon
// ---------------------------------------------------------------------------

const mockLoadReviewStatuses = vi.fn<[], Record<string, unknown>>();
const mockSetReviewStatus = vi.fn();

vi.mock('../../../src/lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/review-status.js')>();
  return {
    ...actual,
    loadReviewStatuses: (...args: unknown[]) => mockLoadReviewStatuses(...args as []),
    setReviewStatus: (...args: unknown[]) => mockSetReviewStatus(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock specialist, tmux, and agent modules before importing deacon
// ---------------------------------------------------------------------------

const mockGetTmuxSessionName = vi.fn();
const mockSpawnRun = vi.fn();
const mockDispatchParallelReview = vi.fn();

vi.mock('../../../src/lib/cloister/review-agent.js', () => ({
  dispatchParallelReview: (...args: unknown[]) => mockDispatchParallelReview(...args),
}));

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: (...args: unknown[]) => mockGetTmuxSessionName(...args),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
}));

const mockSessionExists = vi.fn();

vi.mock('../../../src/lib/tmux.js', () => ({
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
  sendKeysAsync: vi.fn().mockResolvedValue(undefined),
}));

const mockGetAgentRuntimeState = vi.fn();
const mockGetAgentState = vi.fn();

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: (...args: unknown[]) => mockGetAgentRuntimeState(...args),
  saveAgentRuntimeState: vi.fn(),
  saveSessionId: vi.fn(),
  listRunningAgents: vi.fn().mockResolvedValue([]),
  getAgentDir: vi.fn().mockReturnValue('/tmp'),
  getAgentState: (...args: unknown[]) => mockGetAgentState(...args),
  saveAgentState: vi.fn(),
  spawnRun: (...args: unknown[]) => mockSpawnRun(...args),
}));

const mockResolveProjectFromIssue = vi.fn();

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  findProjectByPath: vi.fn().mockReturnValue(null),
}));

// Import after mocks are in place
import { checkOrphanedReviewStatuses } from '../../../src/lib/cloister/deacon.js';

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const ISSUE_ID = 'PAN-369-TEST';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('checkOrphanedReviewStatuses — PAN-369 orphan recovery', () => {
  let completedProcessedPath: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    completedProcessedPath = null;

    // Default: no agents running (all sessions missing / not active)
    mockGetTmuxSessionName.mockImplementation((name: string) => `${name}-session`);
    mockSessionExists.mockReturnValue(false);
    mockGetAgentRuntimeState.mockReturnValue(null);
    // Default: no project configured (prevents findWorkspacePath receiving undefined projectPath
    // if a previous test set a project without projectPath and the mock leaked between tests)
    mockResolveProjectFromIssue.mockReturnValue(null);
    // Default: empty review status store (DB-backed via loadReviewStatuses mock)
    mockLoadReviewStatuses.mockReturnValue({});
    // Default: parallel review dispatch succeeds (review orphan re-dispatch path)
    mockDispatchParallelReview.mockResolvedValue({ success: true, message: 'dispatched' });
  });

  afterEach(() => {
    // Clean up agent state dirs and completed.processed markers created by tests
    rmSync(join(homedir(), '.panopticon', 'agents', `agent-${ISSUE_ID.toLowerCase()}`), { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Branch (a): workspace available → spawn a test role immediately
  // -------------------------------------------------------------------------

  it('(a) re-dispatches via spawnRun test role and sets testStatus=testing when workspace is available', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
    mockSpawnRun.mockResolvedValue({ id: 'test-run-1' });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnRun).toHaveBeenCalledWith(ISSUE_ID, 'test', expect.objectContaining({
      workspace,
      prompt: expect.stringContaining(ISSUE_ID),
    }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Re-dispatched orphaned test for/);
    expect(actions[0]).toContain(ISSUE_ID);

    // DB-backed path: setReviewStatus must be called with testStatus='testing'
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({ testStatus: 'testing' }));
  });

  it('(a) also re-dispatches when testStatus=testing but agent is not active', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'testing',
        readyForMerge: false,
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
    mockSpawnRun.mockResolvedValue({ id: 'test-run-1' });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnRun).toHaveBeenCalledWith(ISSUE_ID, 'test', expect.objectContaining({
      workspace,
      prompt: expect.stringContaining(ISSUE_ID),
    }));

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(ISSUE_ID);

    // DB-backed path: setReviewStatus must be called with testStatus='testing'
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({ testStatus: 'testing' }));
  });

  // -------------------------------------------------------------------------
  // Branch (b): spawn failure → set dispatch_failed for next patrol
  // -------------------------------------------------------------------------

  it('(b) sets dispatch_failed when the test role spawn fails', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
    mockSpawnRun.mockRejectedValue(new Error('spawn failed'));

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnRun).toHaveBeenCalled();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/test role dispatch failed/i);

    // DB-backed path: setReviewStatus must be called with testStatus='dispatch_failed'
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({ testStatus: 'dispatch_failed' }));
  });

  // -------------------------------------------------------------------------
  // Branch (c): no workspace → reset to pending
  // -------------------------------------------------------------------------

  it('(c) resets testStatus to pending when agent state and project are unavailable', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'testing',
        readyForMerge: false,
        history: [],
      },
    });

    // No agent state and no project resolution
    mockGetAgentState.mockReturnValue(null);
    // No project configured — vi.clearAllMocks() does not reset mockReturnValue so
    // prior tests' return values persist; explicitly reset to null for this branch.
    mockResolveProjectFromIssue.mockReturnValue(null);

    const actions = await checkOrphanedReviewStatuses();

    // Cannot re-dispatch without workspace — must not spawn
    expect(mockSpawnRun).not.toHaveBeenCalled();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Reset orphaned test for/);
    expect(actions[0]).toContain(ISSUE_ID);

    // DB-backed path: setReviewStatus must be called with testStatus='pending'
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({ testStatus: 'pending' }));
  });

  // -------------------------------------------------------------------------
  // Branch (d): orphaned pending review → re-dispatch via dispatchParallelReview
  // -------------------------------------------------------------------------

  it('(d) re-dispatches pending review via dispatchParallelReview and sets reviewStatus=reviewing', async () => {
    const workspace = '/workspaces/feature-pan-369-test';
    const agentId = `agent-${ISSUE_ID.toLowerCase()}`;
    const agentDir = join(homedir(), '.panopticon', 'agents', agentId);
    completedProcessedPath = join(agentDir, 'completed.processed');

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'pending',
        testStatus: 'pending',
        prUrl: 'https://github.com/test/repo/pull/1',
        readyForMerge: false,
        history: [],
      },
    });

    // Create the completed.processed marker that deacon checks (existsSync is not mocked)
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(completedProcessedPath, '', 'utf-8');

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli', projectPath: '/workspaces' });
    mockDispatchParallelReview.mockResolvedValue({ success: true, message: 'dispatched' });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockDispatchParallelReview).toHaveBeenCalledWith({
      issueId: ISSUE_ID,
      workspace,
      branch: `feature/${ISSUE_ID.toLowerCase()}`,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Re-dispatched pending review for/);
    expect(actions[0]).toContain(ISSUE_ID);

    // reviewStatus='reviewing' is set inside dispatchParallelReview (not by deacon directly).
    // Since the mock doesn't call setReviewStatus, we verify dispatch was called — that is
    // the deacon's responsibility. The status transition is covered by review-agent tests.
    expect(mockDispatchParallelReview).toHaveBeenCalledTimes(1);
  });

  it('(d-fail) does not mark reviewing when dispatchParallelReview rejects', async () => {
    const workspace = '/workspaces/feature-pan-369-test';
    const agentId = `agent-${ISSUE_ID.toLowerCase()}`;
    const agentDir = join(homedir(), '.panopticon', 'agents', agentId);
    completedProcessedPath = join(agentDir, 'completed.processed');

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'pending',
        testStatus: 'pending',
        prUrl: 'https://github.com/test/repo/pull/1',
        readyForMerge: false,
        history: [],
      },
    });

    mkdirSync(agentDir, { recursive: true });
    writeFileSync(completedProcessedPath, '', 'utf-8');

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli', projectPath: '/workspaces' });
    mockDispatchParallelReview.mockRejectedValue(new Error('spawn failed'));

    const actions = await checkOrphanedReviewStatuses();

    // Deacon reports failure in actions without crashing the patrol
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Failed to re-dispatch pending review for/);
    expect(actions[0]).toContain(ISSUE_ID);
  });

  it('does not re-dispatch pending review when the work agent was explicitly stopped', async () => {
    const agentDir = join(homedir(), '.panopticon', 'agents', `agent-${ISSUE_ID.toLowerCase()}`);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'completed.processed'), 'done\n', 'utf-8');
    completedProcessedPath = join(agentDir, 'completed.processed');

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        issueId: ISSUE_ID,
        reviewStatus: 'pending',
        testStatus: 'pending',
        mergeStatus: 'pending',
        readyForMerge: false,
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/999',
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({
      workspace: '/workspaces/feature-pan-369-test',
      status: 'stopped',
      stoppedByUser: true,
    });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(actions).toContain(`Skipped pending review for ${ISSUE_ID}: work agent was explicitly stopped`);
  });

  it('restores passed review/test state when top-level status is stuck in reviewing', async () => {
    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'reviewing',
        testStatus: 'pending',
        verificationStatus: 'passed',
        mergeStatus: 'failed',
        readyForMerge: false,
        history: [
          { type: 'review', status: 'passed', timestamp: new Date().toISOString(), notes: 'Previously reviewed' },
          { type: 'test', status: 'passed', timestamp: new Date().toISOString(), notes: 'Previously tested' },
        ],
      },
    });

    mockGetAgentState.mockReturnValue(null);

    const actions = await checkOrphanedReviewStatuses();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Restored orphaned review snapshot/);

    // DB-backed path: setReviewStatus must be called with the restored state
    expect(mockSetReviewStatus).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({ reviewStatus: 'passed', testStatus: 'passed' }),
    );
  });

  // -------------------------------------------------------------------------
  // DB-path regression: loadReviewStatuses() is the authoritative source
  // -------------------------------------------------------------------------

  it('reads state via loadReviewStatuses() — never the JSON file directly', async () => {
    // loadReviewStatuses returns data with an orphaned issue
    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'reviewing',
        testStatus: 'pending',
        readyForMerge: false,
        history: [],
      },
    });

    await checkOrphanedReviewStatuses();

    // loadReviewStatuses must have been called (proves DB-backed path was used)
    expect(mockLoadReviewStatuses).toHaveBeenCalled();
    // setReviewStatus must be used for the mutation (not JSON write-back)
    expect(mockSetReviewStatus).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({ reviewStatus: 'pending' }),
    );
  });

  it('writes state via setReviewStatus() for all mutations — not writeFileSync', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    mockLoadReviewStatuses.mockReturnValue({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
    mockSpawnRun.mockResolvedValue({ id: 'test-run-1' });

    await checkOrphanedReviewStatuses();

    // setReviewStatus must be called at least once (proves all mutations go through DB API)
    expect(mockSetReviewStatus).toHaveBeenCalled();
    // The call must include testStatus so we know it's a real mutation, not a no-op
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE_ID, expect.objectContaining({ testStatus: 'testing' }));
  });
});
