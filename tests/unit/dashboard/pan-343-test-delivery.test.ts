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
 * Updated for PAN-3917: nothing writes a test status — delivery is the result
 * this function returns, and the dispatch is gated on the issue having an open
 * pull request to test.
 *
 * Coverage:
 *  1. Spawn succeeds: delivered, agent notified
 *  2. Existing test role run is treated as successful delivery
 *  3. Spawn failure: not delivered, agent NOT notified
 *  4. No project configured: not delivered, agent NOT notified
 *  5. No open pull request: not delivered, agent NOT notified
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
  resolveProjectFromIssueSync: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
}));

// ---------------------------------------------------------------------------
// PAN-3917 (FR-8): the test role runs against a pull request, so the forge is
// asked whether there is one before anything is spawned.
// ---------------------------------------------------------------------------

const mockGetPrFacts = vi.fn();

vi.mock('../../../src/lib/cloister/pr-facts.js', () => ({
  getPrFacts: (...args: unknown[]) => mockGetPrFacts(...args),
}));

vi.mock('../../../src/lib/cloister/merge-verification.js', () => ({
  shouldSkipDispatchAsMerged: vi.fn(async () => ({ skip: false, reason: 'open' })),
  verifyMergedBeforeLifecycle: vi.fn(),
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
  mockResolveProjectFromIssue.mockReturnValue({ projectKey: 'overdeck' });
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
    mockGetPrFacts.mockResolvedValue({ open: true, merged: false });
  });

  it('delivers and notifies the agent when spawn succeeds', async () => {
    setupProjectResolved();
    mockSpawnRun.mockResolvedValue({ id: 'agent-pan-343-test' });
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).toHaveBeenCalledWith(ISSUE, 'test', expect.objectContaining({
      workspace: WS,
      prompt: expect.stringContaining(`TEST TASK for ${ISSUE}`),
    }));
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('treats an already-running test role as delivered and notifies the agent', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('Role run agent-pan-343-test already running'));
    const notify = makeNotify();

    await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalled();
  });

  it('reports spawn-failed and does not notify when spawnRun rejects', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('spawn failed'));
    const notify = makeNotify();

    const result = await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ delivered: false, notified: false, reason: 'spawn-failed' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports no-project and does not spawn when no project is configured', async () => {
    setupNoProject();
    const notify = makeNotify();

    const result = await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ delivered: false, notified: false, reason: 'no-project' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports no-open-pr and does not spawn when the forge has nothing to test', async () => {
    setupProjectResolved();
    mockGetPrFacts.mockResolvedValue({ open: false, merged: true });
    const notify = makeNotify();

    const result = await Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify));

    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ delivered: false, notified: false, reason: 'no-open-pr' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not throw and does not notify the agent when the role runner throws', async () => {
    setupProjectResolved();
    mockSpawnRun.mockRejectedValue(new Error('role runner unavailable'));
    const notify = makeNotify();

    // Core PAN-343 invariant: an exception must NOT advance the pipeline.
    await expect(Effect.runPromise(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify))).resolves.toMatchObject({
      delivered: false,
      notified: false,
      reason: 'spawn-failed',
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
