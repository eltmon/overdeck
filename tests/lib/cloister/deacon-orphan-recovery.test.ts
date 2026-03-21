/**
 * Tests for PAN-369: checkOrphanedReviewStatuses orphan recovery logic.
 *
 * Covers the 3 branches added to checkOrphanedReviewStatuses for the
 * dispatch_failed recovery path:
 *   (a) testStatus='testing'/'dispatch_failed' + issue already in queue
 *       → keep testStatus='testing', action logged, no re-submit
 *   (b) testStatus='dispatch_failed' + queue empty + workspace available in agent state
 *       → re-submit to specialist queue, set testStatus='testing'
 *   (c) testStatus='testing' + queue empty + agent state unavailable
 *       → reset to 'pending' (user must re-trigger manually)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Mock specialist, tmux, and agent modules before importing deacon
// ---------------------------------------------------------------------------

const mockCheckSpecialistQueue = vi.fn();
const mockSubmitToSpecialistQueue = vi.fn();
const mockGetTmuxSessionName = vi.fn();
const mockSpawnEphemeralSpecialist = vi.fn();

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: (...args: unknown[]) => mockGetTmuxSessionName(...args),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  clearSessionId: vi.fn(),
  checkSpecialistQueue: (...args: unknown[]) => mockCheckSpecialistQueue(...args),
  submitToSpecialistQueue: (...args: unknown[]) => mockSubmitToSpecialistQueue(...args),
  spawnEphemeralSpecialist: (...args: unknown[]) => mockSpawnEphemeralSpecialist(...args),
  getNextSpecialistTask: vi.fn(),
  wakeSpecialistWithTask: vi.fn(),
  completeSpecialistTask: vi.fn(),
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
}));

const mockResolveProjectFromIssue = vi.fn();

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
  findProjectByPath: vi.fn().mockReturnValue(null),
}));

// Import after mocks are in place
import { checkOrphanedReviewStatuses } from '../../../src/lib/cloister/deacon.js';

// ---------------------------------------------------------------------------
// Test data and helpers
// ---------------------------------------------------------------------------

// Must match the constant inside deacon.ts
const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');
const ISSUE_ID = 'PAN-369-TEST';

/** Write test fixture data to the review-status file, creating dirs as needed. */
function writeStatusFile(statuses: Record<string, unknown>): void {
  mkdirSync(join(homedir(), '.panopticon'), { recursive: true });
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2), 'utf-8');
}

/** Read and parse the current review-status file. */
function readStatusFile(): Record<string, { testStatus?: string }> {
  return JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('checkOrphanedReviewStatuses — PAN-369 orphan recovery', () => {
  let originalContent: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Back up any existing review-status.json so tests are non-destructive
    if (existsSync(REVIEW_STATUS_FILE)) {
      originalContent = readFileSync(REVIEW_STATUS_FILE, 'utf-8');
    } else {
      originalContent = null;
    }

    // Default: no agents running (all sessions missing / not active)
    mockGetTmuxSessionName.mockImplementation((name: string) => `${name}-session`);
    mockSessionExists.mockReturnValue(false);
    mockGetAgentRuntimeState.mockReturnValue(null);
  });

  afterEach(() => {
    // Restore original state to avoid polluting real Panopticon data
    if (originalContent !== null) {
      writeFileSync(REVIEW_STATUS_FILE, originalContent, 'utf-8');
    } else if (existsSync(REVIEW_STATUS_FILE)) {
      unlinkSync(REVIEW_STATUS_FILE);
    }
  });

  // -------------------------------------------------------------------------
  // Branch (a): issue already in test-agent queue
  // -------------------------------------------------------------------------

  it('(a) retains testStatus=testing and logs action when issue is already queued', async () => {
    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'testing',
        readyForMerge: false,
        history: [],
      },
    });

    // Issue is already in the specialist queue
    mockCheckSpecialistQueue.mockReturnValue({
      items: [{ payload: { issueId: ISSUE_ID } }],
      hasWork: true,
    });

    const actions = await checkOrphanedReviewStatuses();

    // Should NOT re-submit (item already queued)
    expect(mockSubmitToSpecialistQueue).not.toHaveBeenCalled();

    // Action must be logged
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Retained queued test for/);
    expect(actions[0]).toContain(ISSUE_ID);

    // testStatus was already 'testing' — file should NOT be rewritten
    // (no modification was needed)
    const content = readStatusFile();
    expect(content[ISSUE_ID].testStatus).toBe('testing');
  });

  it('(a) updates dispatch_failed to testing when issue is already queued', async () => {
    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

    mockCheckSpecialistQueue.mockReturnValue({
      items: [{ payload: { issueId: ISSUE_ID } }],
      hasWork: true,
    });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSubmitToSpecialistQueue).not.toHaveBeenCalled();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Retained queued test for/);

    // dispatch_failed → testing (so deacon patrol sees the queued item)
    const content = readStatusFile();
    expect(content[ISSUE_ID].testStatus).toBe('testing');
  });

  // -------------------------------------------------------------------------
  // Branch (b): no queue item, workspace available from agent state
  // -------------------------------------------------------------------------

  it('(b) re-dispatches via spawnEphemeralSpecialist and sets testStatus=testing when workspace is available', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

    // Queue is empty for this issue
    mockCheckSpecialistQueue.mockReturnValue({ items: [], hasWork: false });

    // Agent state has the workspace
    mockGetAgentState.mockReturnValue({ workspace });

    // resolveProjectFromIssue returns a valid project
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });

    // spawnEphemeralSpecialist succeeds
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: true, message: 'spawned' });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledWith('panopticon-cli', 'test-agent', {
      issueId: ISSUE_ID,
      workspace,
      branch: `feature/${ISSUE_ID.toLowerCase()}`,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Re-dispatched orphaned test for/);
    expect(actions[0]).toContain(ISSUE_ID);

    // File must be rewritten with updated testStatus
    const content = readStatusFile();
    expect(content[ISSUE_ID].testStatus).toBe('testing');
  });

  // -------------------------------------------------------------------------
  // Branch (c): no queue item, agent state unavailable → reset to pending
  // -------------------------------------------------------------------------

  it('(c) resets testStatus to pending when queue is empty and agent state is unavailable', async () => {
    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'testing',
        readyForMerge: false,
        history: [],
      },
    });

    // Queue is empty
    mockCheckSpecialistQueue.mockReturnValue({ items: [], hasWork: false });

    // No agent state (agent was wiped or never started)
    mockGetAgentState.mockReturnValue(null);

    const actions = await checkOrphanedReviewStatuses();

    // Cannot re-dispatch without workspace — must not spawn
    expect(mockSpawnEphemeralSpecialist).not.toHaveBeenCalled();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/Reset orphaned test for/);
    expect(actions[0]).toContain(ISSUE_ID);

    // File must be rewritten with testStatus reset to pending
    const content = readStatusFile();
    expect(content[ISSUE_ID].testStatus).toBe('pending');
  });
});
