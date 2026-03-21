/**
 * Tests for PAN-343: test-agent delivery failure silently treated as success.
 * Updated for PAN-369: retry logic, dispatch_failed status.
 *
 * Tests the exported `autoQueueTestAgentAndNotify` function from
 * src/lib/cloister/test-agent-queue.ts — the production code extracted from
 * the route handler. Does NOT duplicate logic in a test helper.
 *
 * Coverage:
 *  1. Spawn succeeds on first attempt: testStatus='testing', agent notified
 *  2. First spawn fails, retry succeeds: testStatus='testing', agent notified
 *  3. Both spawn attempts fail: testStatus='dispatch_failed', agent NOT notified
 *  4. No project configured: testStatus='dispatch_failed', agent NOT notified
 *  5. Exception path: catch block sets testStatus='dispatch_failed' and does NOT notify agent
 *  6. Exception + setReviewStatus throws: nested catch prevents outer throw, agent NOT notified
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the specialists module (imported statically by test-agent-queue.ts)
// ---------------------------------------------------------------------------

const mockSpawnEphemeralSpecialist = vi.fn();

vi.mock('../../../src/lib/cloister/specialists.js', () => ({
  spawnEphemeralSpecialist: (...args: unknown[]) => mockSpawnEphemeralSpecialist(...args),
  // Unused exports referenced by other modules imported transitively
  getEnabledSpecialists: vi.fn().mockReturnValue([]),
  getTmuxSessionName: vi.fn().mockReturnValue('test-agent'),
  isRunning: vi.fn().mockResolvedValue(false),
  initializeSpecialist: vi.fn(),
  wakeSpecialist: vi.fn(),
  wakeSpecialistOrQueue: vi.fn(),
  checkSpecialistQueue: vi.fn(),
  submitToSpecialistQueue: vi.fn(),
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
// Mock resolveProjectFromIssue
// ---------------------------------------------------------------------------

const mockResolveProjectFromIssue = vi.fn();

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: (...args: unknown[]) => mockResolveProjectFromIssue(...args),
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
const PROJECT_KEY = 'panopticon';

function makeNotify() {
  return vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined);
}

function resolveProject() {
  mockResolveProjectFromIssue.mockReturnValue({ projectKey: PROJECT_KEY });
}

function resolveNoProject() {
  mockResolveProjectFromIssue.mockReturnValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoQueueTestAgentAndNotify (PAN-343 + PAN-369)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets testStatus to testing and notifies agent when spawn succeeds on first attempt', async () => {
    resolveProject();
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: true, message: 'spawned' });
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledTimes(1);
    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledWith(PROJECT_KEY, 'test-agent', {
      issueId: ISSUE,
      workspace: WS,
      branch: BRANCH,
    });
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('retries once after 2s and sets testStatus to testing when retry succeeds', async () => {
    vi.useFakeTimers();
    resolveProject();
    mockSpawnEphemeralSpecialist
      .mockResolvedValueOnce({ success: false, message: 'busy' })
      .mockResolvedValueOnce({ success: true, message: 'spawned on retry' });
    const notify = makeNotify();

    const promise = autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledTimes(2);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, { testStatus: 'testing' });
    expect(notify).toHaveBeenCalledWith(
      `agent-${ISSUE.toLowerCase()}`,
      expect.stringContaining('REVIEW PASSED'),
    );
  });

  it('sets testStatus to dispatch_failed and does NOT notify agent when both spawn attempts fail', async () => {
    vi.useFakeTimers();
    resolveProject();
    mockSpawnEphemeralSpecialist.mockResolvedValue({ success: false, message: 'all slots full' });
    const notify = makeNotify();

    const promise = autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    vi.useRealTimers();

    expect(mockSpawnEphemeralSpecialist).toHaveBeenCalledTimes(2);
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('all slots full'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets testStatus to dispatch_failed when no project is configured for the issue', async () => {
    resolveNoProject();
    const notify = makeNotify();

    await autoQueueTestAgentAndNotify(ISSUE, WS, BRANCH, notify);

    expect(mockSpawnEphemeralSpecialist).not.toHaveBeenCalled();
    expect(mockSetReviewStatus).toHaveBeenCalledWith(ISSUE, {
      testStatus: 'dispatch_failed',
      testNotes: expect.stringContaining('No project configured'),
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sets testStatus to dispatch_failed and does NOT notify agent when specialists module throws', async () => {
    resolveProject();
    mockSpawnEphemeralSpecialist.mockRejectedValue(new Error('specialists module unavailable'));
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
    resolveProject();
    mockSpawnEphemeralSpecialist.mockRejectedValue(new Error('specialists unavailable'));
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
