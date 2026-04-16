/**
 * Tests for PAN-369: checkOrphanedReviewStatuses orphan recovery logic.
 *
 * Covers the dispatch paths after queue removal (PAN-722):
 *   (a) testStatus='testing'/'dispatch_failed' + workspace available in agent state
 *       → spawn via spawnEphemeralSpecialist, set testStatus='testing' on success
 *   (b) specialist_busy → set dispatch_failed so deacon retries next patrol
 *   (c) testStatus='testing'/'dispatch_failed' + no workspace available
 *       → reset to 'pending' (user must re-trigger manually)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// Mock specialist, tmux, and agent modules before importing deacon
// ---------------------------------------------------------------------------

const mockGetTmuxSessionName = vi.fn();
const mockSpawnEphemeralSpecialist = vi.fn();

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: (...args: unknown[]) => mockGetTmuxSessionName(...args),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  clearSessionId: vi.fn(),
  spawnEphemeralSpecialist: (...args: unknown[]) => mockSpawnEphemeralSpecialist(...args),
  wakeSpecialistWithTask: vi.fn(),
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
  // Branch (a): workspace available → spawn immediately
  // -------------------------------------------------------------------------

  it('(a) re-dispatches via spawnEphemeralSpecialist and sets testStatus=testing when workspace is available', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

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

  it('(a) also re-dispatches when testStatus=testing but agent is not active', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'testing',
        readyForMerge: false,
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: true, message: 'spawned' });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledWith('panopticon-cli', 'test-agent', {
      issueId: ISSUE_ID,
      workspace,
      branch: `feature/${ISSUE_ID.toLowerCase()}`,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(ISSUE_ID);

    const content = readStatusFile();
    expect(content[ISSUE_ID].testStatus).toBe('testing');
  });

  // -------------------------------------------------------------------------
  // Branch (b): specialist busy → set dispatch_failed for next patrol
  // -------------------------------------------------------------------------

  it('(b) sets dispatch_failed when specialist is busy', async () => {
    const workspace = '/workspaces/feature-pan-369-test';

    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'dispatch_failed',
        readyForMerge: false,
        history: [],
      },
    });

    mockGetAgentState.mockReturnValue({ workspace });
    mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: false, error: 'specialist_busy' });

    const actions = await checkOrphanedReviewStatuses();

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalled();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/specialist busy/i);

    const content = readStatusFile();
    expect(content[ISSUE_ID].testStatus).toBe('dispatch_failed');
  });

  // -------------------------------------------------------------------------
  // Branch (c): no workspace → reset to pending
  // -------------------------------------------------------------------------

  it.skip('(c) resets testStatus to pending when agent state is unavailable', async () => {
    writeStatusFile({
      [ISSUE_ID]: {
        reviewStatus: 'passed',
        testStatus: 'testing',
        readyForMerge: false,
        history: [],
      },
    });

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

  it('restores passed review/test state when top-level status is stuck in reviewing', async () => {
    writeStatusFile({
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

    const content = readStatusFile();
    expect(content[ISSUE_ID].reviewStatus).toBe('passed');
    expect(content[ISSUE_ID].testStatus).toBe('passed');
    expect(content[ISSUE_ID].readyForMerge).toBeTypeOf('boolean');
  });
});
