/**
 * Tests for PAN-343: test-agent delivery failure silently treated as success.
 * Updated for PAN-369: retry logic, dispatch_failed status.
 * Updated for PAN-722: queue removal — direct ephemeral dispatch only.
 *
 * Tests the exported `dispatchTestAgentAndNotify` function from
 * src/lib/cloister/test-agent-queue.ts — the production code extracted from
 * the route handler. Does NOT duplicate logic in a test helper.
 *
 * Coverage:
 *  1. Spawn succeeds: testStatus='testing', agent notified
 *  2. First spawn fails (non-busy), retry succeeds: testStatus='testing', agent notified
 *  3. specialist_busy: sets dispatch_failed immediately (no retry)
 *  4. Both spawn attempts fail: testStatus='dispatch_failed', agent NOT notified
 *  5. No project configured: dispatch_failed, agent NOT notified
 *  6. Exception path: catch block sets testStatus='dispatch_failed' and does NOT notify agent
 *  7. Exception + setReviewStatus throws: nested catch prevents outer throw, agent NOT notified
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the specialists module (imported statically by test-agent-queue.ts)
// ---------------------------------------------------------------------------

const mockSpawnEphemeralSpecialist = vi.fn();

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  spawnEphemeralSpecialist: (...args: unknown[]) => mockSpawnEphemeralSpecialist(...args),
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
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: true, message: 'spawned' });
    const notify = makeNotify();

    await dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('sets testStatus to testing and notifies agent on retry when first spawn fails', async () => {
    vi.useFakeTimers();
    setupProjectResolved();
    mockSpawnEphemeralSpecialist
      .mockResolvedValueOnce({ success: false, message: 'busy' })
      .mockResolvedValueOnce({ success: true, message: 'spawned on retry' });
    const notify = makeNotify();

    const promise = dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledTimes(2);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalled();
  });

  it('sets dispatch_failed immediately without retry when specialist_busy', async () => {
    setupProjectResolved();
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: false, error: 'specialist_busy' });
    const notify = makeNotify();

    await dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    // specialist_busy should NOT trigger a retry
    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledTimes(1);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('deacon will retry'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('retries once then sets dispatch_failed when both spawn attempts fail', async () => {
    vi.useFakeTimers();
    setupProjectResolved();
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: false, message: 'spawn failed' });
    const notify = makeNotify();

    const promise = dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    // Both spawn attempts must be made
    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledTimes(2);
    // Should set dispatch_failed after both attempts fail
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('spawn failed'),
    });
    // Must NOT notify agent on failure
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets dispatch_failed when both spawn attempts fail and does not notify', async () => {
    vi.useFakeTimers();
    setupProjectResolved();
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: false, message: 'all busy' });
    const notify = makeNotify();

    const promise = dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, expect.objectContaining({ testStatus: 'dispatch_failed' }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets dispatch_failed when no project is configured for the issue', async () => {
    setupNoProject();
    const notify = makeNotify();

    await dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSpawnEphemeralSpecialist).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('No project configured'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets testStatus to dispatch_failed and does NOT notify agent when specialists module throws', async () => {
    setupProjectResolved();
    mockSpawnEphemeralSpecialist.mockRejectedValue(new Error('specialists module unavailable'));
    const notify = makeNotify();

    await dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    // Core PAN-343 invariant: exception must NOT advance the pipeline
    expect(notify).not.toHaveBeenCalled();
    // PAN-369: exception must set dispatch_failed so deacon can recover
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('specialists module unavailable'),
    });
  });

  it('does not throw and does not notify agent when setReviewStatus itself throws in the catch block', async () => {
    setupProjectResolved();
    mockSpawnEphemeralSpecialist.mockRejectedValue(new Error('specialists unavailable'));
    // setReviewStatus throws when trying to persist dispatch_failed
    mockSetReviewStatus.mockImplementation(() => {
      throw new Error('status file write failed');
    });
    const notify = makeNotify();

    // The nested catch must prevent this from propagating
    await expect(dispatchTestAgentAndNotify(ISSUE, WS, BRANCH, notify)).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
