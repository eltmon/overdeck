import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../../src/lib/review-status.js';

const {
  mockLoadReviewStatuses,
  mockGetReviewStatusSync,
  mockQueryLatestPerIssue,
  mockAppend,
  mockGetDashboardIdentity,
  mockEmitReviewStatusChanged,
} = vi.hoisted(() => ({
  mockLoadReviewStatuses: vi.fn(),
  mockGetReviewStatusSync: vi.fn(),
  mockQueryLatestPerIssue: vi.fn(),
  mockAppend: vi.fn(),
  mockGetDashboardIdentity: vi.fn(),
  mockEmitReviewStatusChanged: vi.fn(),
}));

vi.mock('../../../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: mockLoadReviewStatuses,
  getReviewStatusSync: mockGetReviewStatusSync,
}));

vi.mock('../../../../../src/dashboard/server/event-store.js', () => ({
  getEventStore: () => ({
    queryLatestPerIssue: mockQueryLatestPerIssue,
    append: mockAppend,
  }),
}));

vi.mock('../../../../../src/dashboard/server/identity.js', () => ({
  getDashboardIdentity: mockGetDashboardIdentity,
}));

vi.mock('../../../../../src/dashboard/server/review-status-emit.js', () => ({
  emitReviewStatusChanged: mockEmitReviewStatusChanged,
}));

import {
  startReviewStatusReconcileService,
  stopReviewStatusReconcileService,
} from '../../../../../src/dashboard/server/services/review-status-reconcile-service.js';

const canonical: ReviewStatus = {
  issueId: 'PAN-2988',
  reviewStatus: 'passed',
  testStatus: 'passed',
  verificationStatus: 'passed',
  mergeStatus: 'pending',
  readyForMerge: true,
  updatedAt: '2026-07-22T20:01:00.000Z',
};

function statusEvent(updatedAt: string) {
  return {
    sequence: 10,
    type: 'review.status_changed',
    timestamp: '2026-07-22T20:00:00.000Z',
    payload: {
      issueId: canonical.issueId,
      status: { ...canonical, updatedAt },
    },
  };
}

describe('review status reconcile service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockLoadReviewStatuses.mockReset();
    mockGetReviewStatusSync.mockReset();
    mockQueryLatestPerIssue.mockReset();
    mockAppend.mockReset();
    mockGetDashboardIdentity.mockReset();
    mockEmitReviewStatusChanged.mockReset();
    mockGetDashboardIdentity.mockReturnValue({ mode: 'primary', repoRoot: process.cwd() });
    mockLoadReviewStatuses.mockReturnValue({ [canonical.issueId]: canonical });
    mockGetReviewStatusSync.mockReturnValue(canonical);
    mockEmitReviewStatusChanged.mockImplementation((append, issueId, status) => {
      append({
        type: 'review.status_changed',
        timestamp: new Date().toISOString(),
        payload: { issueId, status },
      });
    });
    stopReviewStatusReconcileService();
  });

  afterEach(() => {
    stopReviewStatusReconcileService();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('re-emits one event when the canonical status is newer than the latest event', async () => {
    mockQueryLatestPerIssue.mockReturnValue([statusEvent('2026-07-22T20:00:00.000Z')]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(startReviewStatusReconcileService()).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEmitReviewStatusChanged).toHaveBeenCalledOnce();
    expect(mockAppend).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      `[review-status-reconcile] re-emitting status for ${canonical.issueId} ` +
      '(canonical newer than last event — healing lost status_changed)',
    );
  });

  it('does not emit across several ticks when the latest event matches canonical status', async () => {
    mockQueryLatestPerIssue.mockReturnValue([statusEvent(canonical.updatedAt)]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(mockEmitReviewStatusChanged).not.toHaveBeenCalled();
    expect(mockAppend).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('continues running after a reconcile tick throws', async () => {
    mockLoadReviewStatuses
      .mockImplementationOnce(() => { throw new Error('transient read failure'); })
      .mockReturnValue({ [canonical.issueId]: canonical });
    mockQueryLatestPerIssue.mockReturnValue([]);

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockAppend).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockAppend).toHaveBeenCalledOnce();
  });
});
