/**
 * Tests for PAN-343: test-agent delivery failure silently treated as success.
 *
 * Tests the exported `autoQueueTestAgentAndNotify` function from
 * src/lib/cloister/test-agent-queue.ts — the production code extracted from
 * the route handler. Does NOT duplicate logic in a test helper.
 *
 * Coverage:
 *  1. Wake succeeds (queued=false): testStatus='testing', agent notified
 *  2. Wake succeeds (queued=true, specialist busy): testStatus='testing', agent notified
 *  3. Wake fails: submitToSpecialistQueue called as fallback, agent notified
 *  4. Wake fails: testStatus still set to 'testing' via fallback path
 *  5. Already queued: no wake/re-queue, testStatus refreshed, agent notified
 *  6. Exception path: specialists module throws → testTaskDelivered=false,
 *     agent NOT notified (core PAN-343 safety invariant)
 *  7. Already-queued path calls setReviewStatus to refresh stale testStatus (B3)
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

describe('autoQueueTestAgentAndNotify (PAN-343)', () => {
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

  it('falls back to submitToSpecialistQueue when wake fails', async () => {
    queueWithoutIssue();
    mockWakeSpecialistOrQueue.mockResolvedValue({
      success: false,
      queued: false,
      message: 'Task message not received by specialist test-agent after retry',
    });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSubmitToSpecialistQueue).toHaveBeenCalledWith('test-agent', {
      priority: 'normal',
      source: 'review-passed-delivery-retry',
      issueId: ISSUE,
      workspace: WS,
      branch: BRANCH,
    });
  });

  it('sets testStatus to testing after wake-failure fallback', async () => {
    queueWithoutIssue();
    mockWakeSpecialistOrQueue.mockResolvedValue({
      success: false,
      queued: false,
      message: 'Task message not received by specialist test-agent after retry',
    });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

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

  it('does NOT notify agent when specialists module throws (exception path safety invariant)', async () => {
    // Simulate an unrecoverable error in the queuing block
    mockCheckSpecialistQueue.mockImplementation(() => {
      throw new Error('specialists module unavailable');
    });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    // The core PAN-343 invariant: exception must NOT advance the pipeline
    expect(notify).not.toHaveBeenCalled();
  });
});
