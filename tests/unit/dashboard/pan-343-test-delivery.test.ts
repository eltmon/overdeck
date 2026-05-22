import { Effect } from 'effect';
/**
 * Tests for PAN-343: test-agent delivery failure silently treated as success.
 * Updated for PAN-369: retry logic, dispatch_failed status.
 * Updated for PAN-1048: role-based test dispatch via spawnRun(issue, 'test').
 *
 * Tests the exported `dispatchTestAgentAndNotify` function from
 * src/lib/cloister/test-agent-queue.ts — the production code extracted from
 * the route handler. Does NOT duplicate logic in a test helper.
 *
 * Coverage:
 *  1. Spawn succeeds: testStatus='testing', agent notified
 *  2. Existing test role run is treated as successful delivery
 *  3. Spawn failure: testStatus='dispatch_failed', agent NOT notified
 *  4. No project configured: dispatch_failed, agent NOT notified
 *  5. Exception path: catch block sets testStatus='dispatch_failed' and does NOT notify agent
 *  6. Exception + setReviewStatus throws: nested catch prevents outer throw, agent NOT notified
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the role runner (imported statically by test-agent-queue.ts)
// ---------------------------------------------------------------------------

const mockSpawnRun = vi.fn();

vi.mock('../../../src/lib/agents.js', () => ({
  spawnRun: (...args: unknown[]) => mockSpawnRun(...args),
}));

// ---------------------------------------------------------------------------
// Mock projects module (resolveProjectFromIssue)
// ---------------------------------------------------------------------------

const mockResolveProjectFromIssue = vi.fn();

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
}));

// ---------------------------------------------------------------------------
// Mock review-status (file I/O side effect)
// ---------------------------------------------------------------------------

const mockSetReviewStatus = vi.fn();

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: (...args: unknown[]) => mockSetReviewStatus(...args),
  getReviewStatus: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the production function AFTER mocks are in place
// ---------------------------------------------------------------------------

import { dispatchTestAgentAndNotify } from '../../../src/lib/cloister/test-agent-queue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISSUE = 'PAN-343';
const WS = '/workspaces/feature-pan-343';
const BRANCH = 'feature/pan-343';

function makeNotify() {
  return vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined);
}

/** Set up mocks so resolveProjectFromIssue returns a project */
function setupProjectResolved() {
  mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'panopticon-cli' });
}

/** Set up mocks so resolveProjectFromIssue returns null (no project) */
function setupNoProject() {
  mockResolveProjectFromIssue.mockReturnValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dispatchTestAgentAndNotify (PAN-343 + PAN-369)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets testStatus to testing and notifies agent when spawn succeeds', async () => {
    setupProjectResolved();
    mockSpawnRun.mockResolvedValue({ id: 'agent-pan-343-test' });
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).toHaveBeenCalledWith(ISSUE, 'test', expect.objectContaining({
      workspace: WS,
      prompt: expect.stringContaining(`TEST TASK for ${ISSUE}`),
    }));
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('sets testStatus to testing and notifies agent when the test role is already running', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('Role run agent-pan-343-test already running'));
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalled();
  });

  it('sets dispatch_failed when spawnRun rejects and does not notify', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('spawn failed'));
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('spawn failed'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets dispatch_failed when no project is configured for the issue', async () => {
    setupNoProject();
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('No project configured'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets testStatus to dispatch_failed and does NOT notify agent when role runner throws', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('role runner unavailable'));
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    // Core PAN-343 invariant: exception must NOT advance the pipeline
    expect(notify).not.toHaveBeenCalled();
    // PAN-369: exception must set dispatch_failed so deacon can recover
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('role runner unavailable'),
    });
  });

  it('does not throw and does not notify agent when setReviewStatus itself throws in the catch block', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('role runner unavailable'));
    // setReviewStatus throws when trying to persist dispatch_failed
    mockSetReviewStatus.mockImplementation(() => {
      throw new Error('status file write failed');
    });
    const notify = makeNotify();

    // The nested catch must prevent this from propagating
    await (await Effect.runPromise(expect(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify))))SUE, WS, BRANCH, notify)))).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
