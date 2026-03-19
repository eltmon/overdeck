/**
 * Tests for PAN-343: test-agent delivery failure silently treated as success.
 * Updated for PAN-369: retry logic, dispatch_failed status.
 *
 * Tests the exported `autoQueueTestAgentAndNotify` function from
 * src/lib/cloister/test-agent-queue.ts — the production code extracted from
 * the route handler. Does NOT duplicate logic in a test helper.
 *
 * Coverage:
 *  1. Wake succeeds (queued=false): testStatus='testing', agent notified
 *  2. Wake succeeds (queued=true, specialist busy): testStatus='testing', agent notified
 *  3. Wake fails both attempts: retry sources verified, submitToSpecialistQueue called
 *  4. Wake fails both attempts: testStatus still set to 'testing' via fallback path
 *  5. Already queued: no wake/re-queue, testStatus refreshed, agent notified
 *  6. Exception path: catch block sets testStatus='dispatch_failed' and does NOT notify agent
 *  7. Exception + setReviewStatus throws: nested catch prevents outer throw, agent NOT notified
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the specialists module (imported statically by test-agent-queue.ts)
// ---------------------------------------------------------------------------

const mockWakeSpecialistOrQueue = vi.fn();
const mockCheckSpecialistQueue = vi.fn();
const mockSubmitToSpecialistQueue = vi.fn();

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  wakeSpecialistOrQueue: (...args: unknown[]) => mockWakeSpecialistOrQueue(...args),
  checkSpecialistQueue: (...args: unknown[]) => mockCheckSpecialistQueue(...args),
  submitToSpecialistQueue: (...args: unknown[]) => mockSubmitToSpecialistQueue(...args),
  // Unused exports referenced by other modules imported transitively
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn().mockReturnValue('test-agent'),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  clearSessionId: vi.fn(),
  getNextSpecialistTask: vi.fn(),
  wakeSpecialistWithTask: vi.fn(),
  completeSpecialistTask: vi.fn(),
  getAllProjectSpecialistStatuses: vi.fn().mockResolvedValue([]),
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

import { autoQueueTestAgentAndNotify } from '../../../src/lib/cloister/test-agent-queue.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISSUE = 'PAN-343';
const WS = '/workspaces/feature-pan-343';
const BRANCH = 'feature/pan-343';

function makeNotify() {
  return vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined);
}

function queueWithoutIssue() {
  mockCheckSpecialistQueue.mockReturnValue({ items: [], hasWork: false });
}

function queueAlreadyHasIssue() {
  mockCheckSpecialistQueue.mockReturnValue({
    items: [{ payload: { issueId: ISSUE } }],
    hasWork: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoQueueTestAgentAndNotify (PAN-343 + PAN-369)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets testStatus to testing and notifies agent when wake succeeds (direct)', async () => {
    queueWithoutIssue();
    mockWakeSpecialistOrQueue.mockResolvedValue({ success: true, queued: false, message: 'woken' });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(mockSubmitToSpecialistQueue).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('sets testStatus to testing and notifies agent when wake queues (specialist busy)', async () => {
    queueWithoutIssue();
    mockWakeSpecialistOrQueue.mockResolvedValue({ success: true, queued: true, message: 'queued' });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalled();
  });

  it('retries once with different source then falls back to queue when both wake attempts fail', async () => {
    vi.useFakeTimers();
    queueWithoutIssue();
    mockWakeSpecialistOrQueue.mockResolvedValue({
      success: false,
      queued: false,
      message: 'Task message not received by specialist test-agent after retry',
    });
    const notify = makeNotify();

    const promise = autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    // Both wake attempts must be made
    expect(mockWakeSpecialistOrQueue).toHaveBeenCalledTimes(2);
    // First attempt uses the primary source
    expect(mockWakeSpecialistOrQueue).toHaveBeenNthCalledWith(
      1,
      'test-agent',
      expect.objectContaining({ issueId: ISSUE }),
      expect.objectContaining({ source: 'review-passed-auto' }),
    );
    // Retry uses a distinct source so logs are traceable
    expect(mockWakeSpecialistOrQueue).toHaveBeenNthCalledWith(
      2,
      'test-agent',
      expect.objectContaining({ issueId: ISSUE }),
      expect.objectContaining({ source: 'review-passed-auto-retry' }),
    );
    expect(mockSubmitToSpecialistQueue).toHaveBeenCalledWith('test-agent', {
      priority: 'normal',
      source: 'review-passed-delivery-retry',
      issueId: ISSUE,
      workspace: WS,
      branch: BRANCH,
    });
  });

  it('sets testStatus to testing and notifies agent after both wake failures + queue fallback', async () => {
    vi.useFakeTimers();
    queueWithoutIssue();
    mockWakeSpecialistOrQueue.mockResolvedValue({
      success: false,
      queued: false,
      message: 'Task message not received by specialist test-agent after retry',
    });
    const notify = makeNotify();

    const promise = autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    // testStatus must only be set AFTER queue submission succeeds (not before)
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('refreshes testStatus and notifies agent when issue is already queued (B3)', async () => {
    queueAlreadyHasIssue();
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockWakeSpecialistOrQueue).not.toHaveBeenCalled();
    expect(mockSubmitToSpecialistQueue).not.toHaveBeenCalled();
    // B3: setReviewStatus must be called even in the already-queued path
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalled();
  });

  it('sets testStatus to dispatch_failed and does NOT notify agent when specialists module throws', async () => {
    mockCheckSpecialistQueue.mockImplementation(() => {
      throw new Error('specialists module unavailable');
    });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    // Core PAN-343 invariant: exception must NOT advance the pipeline
    expect(notify).not.toHaveBeenCalled();
    // PAN-369: exception must set dispatch_failed so deacon can recover
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('specialists module unavailable'),
    });
  });

  it('does not throw and does not notify agent when setReviewStatus itself throws in the catch block', async () => {
    mockCheckSpecialistQueue.mockImplementation(() => {
      throw new Error('specialists unavailable');
    });
    // setReviewStatus throws when trying to persist dispatch_failed
    mockSetReviewStatus.mockImplementation(() => {
      throw new Error('status file write failed');
    });
    const notify = makeNotify();

    // The nested catch must prevent this from propagating
    await expect(autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify)).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
