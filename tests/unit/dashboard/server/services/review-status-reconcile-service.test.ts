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

vi.mock('../../../../../src/dashboard/server/review-status-emit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/dashboard/server/review-status-emit.js')>()),
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

function statusEvent(updatedAt: string, status: ReviewStatus = canonical) {
  return {
    sequence: 10,
    type: 'review.status_changed',
    timestamp: '2026-07-22T20:00:00.000Z',
    payload: {
      issueId: canonical.issueId,
      status: { ...status, updatedAt },
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
      '(canonical differs from last event — healing lost status_changed)',
    );
  });

  it('heals one unchanged divergence, warns once, then heals after canonical advances', async () => {
    mockQueryLatestPerIssue.mockReturnValue([statusEvent('2026-07-22T20:00:00.000Z')]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(mockEmitReviewStatusChanged).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      `[review-status-reconcile] NOT CONVERGING for ${canonical.issueId}: ` +
      `canonical=${canonical.updatedAt} event=2026-07-22T20:00:00.000Z`,
    );

    const advanced = { ...canonical, updatedAt: '2026-07-22T20:02:00.000Z' };
    mockGetReviewStatusSync.mockReturnValue(advanced);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockEmitReviewStatusChanged).toHaveBeenCalledTimes(2);
  });

  it('skips retired canonical records without emitting or warning', async () => {
    mockGetReviewStatusSync.mockReturnValue({ ...canonical, retiredAt: '2026-08-16T00:00:00Z' });
    mockQueryLatestPerIssue.mockReturnValue([statusEvent('2026-07-22T20:00:00.000Z')]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(2 * 60_000);

    expect(mockEmitReviewStatusChanged).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('forgets reconciliation tracking when an issue retires', async () => {
    mockQueryLatestPerIssue.mockReturnValue([statusEvent('2026-07-22T20:00:00.000Z')]);
    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockEmitReviewStatusChanged).toHaveBeenCalledOnce();

    mockGetReviewStatusSync.mockReturnValue({ ...canonical, retiredAt: '2026-08-16T00:00:00Z' });
    await vi.advanceTimersByTimeAsync(60_000);
    mockGetReviewStatusSync.mockReturnValue(canonical);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEmitReviewStatusChanged).toHaveBeenCalledTimes(2);
  });

  it('does not emit across several ticks when persisted JSON matches canonical status', async () => {
    const canonicalWithUndefined = { ...canonical, mergeNotes: undefined };
    const persisted = JSON.parse(JSON.stringify({
      ...canonicalWithUndefined,
      reviewSessionNames: ['agent-pan-2988-review-correctness'],
    })) as ReviewStatus;
    mockLoadReviewStatuses.mockReturnValue({ [canonical.issueId]: canonicalWithUndefined });
    mockGetReviewStatusSync.mockReturnValue(canonicalWithUndefined);
    mockQueryLatestPerIssue.mockReturnValue([statusEvent(canonical.updatedAt, persisted)]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(Object.hasOwn(canonicalWithUndefined, 'mergeNotes')).toBe(true);
    expect(Object.hasOwn(persisted, 'mergeNotes')).toBe(false);

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(mockEmitReviewStatusChanged).not.toHaveBeenCalled();
    expect(mockAppend).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('re-emits when equal timestamps carry different canonical status', async () => {
    const older = {
      ...canonical,
      testStatus: 'testing' as const,
      readyForMerge: false,
    };
    mockQueryLatestPerIssue.mockReturnValue([statusEvent(canonical.updatedAt, older)]);

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEmitReviewStatusChanged).toHaveBeenCalledOnce();
    expect(mockEmitReviewStatusChanged).toHaveBeenCalledWith(
      expect.any(Function),
      canonical.issueId,
      canonical,
    );
    expect(mockAppend).toHaveBeenCalledOnce();
  });

  it('re-emits a newer merged status', async () => {
    const merged = {
      ...canonical,
      mergeStatus: 'merged' as const,
      readyForMerge: false,
      updatedAt: '2026-07-22T20:02:00.000Z',
    };
    mockLoadReviewStatuses.mockReturnValue({ [merged.issueId]: merged });
    mockGetReviewStatusSync.mockReturnValue(merged);
    mockQueryLatestPerIssue.mockReturnValue([statusEvent(canonical.updatedAt)]);

    startReviewStatusReconcileService();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockEmitReviewStatusChanged).toHaveBeenCalledOnce();
    expect(mockEmitReviewStatusChanged).toHaveBeenCalledWith(
      expect.any(Function),
      merged.issueId,
      merged,
    );
    expect(mockAppend).toHaveBeenCalledOnce();
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
