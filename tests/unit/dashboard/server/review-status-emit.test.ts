import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

const { mockEnrichReviewStatus, mockGetReviewStatusSync } = vi.hoisted(() => ({
  mockEnrichReviewStatus: vi.fn(),
  mockGetReviewStatusSync: vi.fn(),
}));

vi.mock('../../../../src/lib/review-status-enrichment.js', () => ({
  enrichReviewStatus: mockEnrichReviewStatus,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatusSync,
}));

import { emitReviewStatusChanged } from '../../../../src/dashboard/server/review-status-emit.js';

const status: ReviewStatus = {
  issueId: 'PAN-2988',
  reviewStatus: 'passed',
  testStatus: 'passed',
  verificationStatus: 'passed',
  mergeStatus: 'pending',
  readyForMerge: true,
  updatedAt: '2026-07-22T20:00:00.000Z',
};

describe('emitReviewStatusChanged', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T21:00:00.000Z'));
    mockEnrichReviewStatus.mockReset();
    mockGetReviewStatusSync.mockReset();
    mockGetReviewStatusSync.mockReturnValue(status);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('appends the unenriched status synchronously before enrichment resolves', async () => {
    let resolveEnrichment!: (value: ReviewStatus) => void;
    mockEnrichReviewStatus.mockReturnValue(Effect.promise(() => new Promise<ReviewStatus>((resolve) => {
      resolveEnrichment = resolve;
    })));
    const append = vi.fn();

    emitReviewStatusChanged(append, status.issueId, status);

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      type: 'review.status_changed',
      timestamp: '2026-07-22T21:00:00.000Z',
      payload: { issueId: status.issueId, status },
    });

    resolveEnrichment(status);
    await vi.advanceTimersByTimeAsync(0);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('keeps the durable event and warns when enrichment exceeds five seconds', async () => {
    mockEnrichReviewStatus.mockReturnValue(Effect.never);
    const append = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    emitReviewStatusChanged(append, status.issueId, status);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(append).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[pipeline] review-status enrichment timed out or failed for ${status.issueId}; unenriched event already appended`,
    );
  });

  it('appends an enrichment patch when sugar is produced and canonical status is unchanged', async () => {
    const enriched = { ...status, reviewSessionNames: ['agent-pan-2988-review-correctness'] };
    mockEnrichReviewStatus.mockReturnValue(Effect.succeed(enriched));
    const append = vi.fn();

    emitReviewStatusChanged(append, status.issueId, status);
    await vi.advanceTimersByTimeAsync(0);

    expect(append).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenLastCalledWith({
      type: 'review.status_changed',
      timestamp: '2026-07-22T21:00:00.000Z',
      payload: { issueId: status.issueId, status: enriched },
    });
  });

  it('skips an enrichment patch when a newer canonical status has landed', async () => {
    mockEnrichReviewStatus.mockReturnValue(Effect.succeed({
      ...status,
      reviewCoordinatorSessionName: 'agent-pan-2988-review',
    }));
    mockGetReviewStatusSync.mockReturnValue({
      ...status,
      updatedAt: '2026-07-22T20:00:01.000Z',
    });
    const append = vi.fn();

    emitReviewStatusChanged(append, status.issueId, status);
    await vi.advanceTimersByTimeAsync(0);

    expect(append).toHaveBeenCalledTimes(1);
  });

  it('rejects an older enrichment patch when two transitions share updatedAt', async () => {
    const older = { ...status, testStatus: 'testing' as const, readyForMerge: false };
    const newer = { ...status, testStatus: 'passed' as const, readyForMerge: true };
    let resolveOlder!: (value: ReviewStatus) => void;
    let resolveNewer!: (value: ReviewStatus) => void;
    mockEnrichReviewStatus
      .mockReturnValueOnce(Effect.promise(() => new Promise<ReviewStatus>((resolve) => {
        resolveOlder = resolve;
      })))
      .mockReturnValueOnce(Effect.promise(() => new Promise<ReviewStatus>((resolve) => {
        resolveNewer = resolve;
      })));
    mockGetReviewStatusSync.mockReturnValue(newer);
    const append = vi.fn();

    emitReviewStatusChanged(append, status.issueId, older);
    emitReviewStatusChanged(append, status.issueId, newer);
    expect(append).toHaveBeenCalledTimes(2);

    resolveNewer({
      ...newer,
      reviewCoordinatorSessionName: 'agent-pan-2988-review',
    } as ReviewStatus);
    await vi.advanceTimersByTimeAsync(0);
    expect(append).toHaveBeenCalledTimes(3);

    resolveOlder({
      ...older,
      reviewCoordinatorSessionName: 'agent-pan-2988-review',
    } as ReviewStatus);
    await vi.advanceTimersByTimeAsync(0);

    expect(append).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        status: expect.objectContaining({ testStatus: 'passed', readyForMerge: true }),
      }),
    }));
  });

  it('skips an enrichment patch when enrichment produces no sugar', async () => {
    mockEnrichReviewStatus.mockReturnValue(Effect.succeed({ ...status }));
    const append = vi.fn();

    emitReviewStatusChanged(append, status.issueId, status);
    await vi.advanceTimersByTimeAsync(0);

    expect(append).toHaveBeenCalledTimes(1);
    expect(mockGetReviewStatusSync).not.toHaveBeenCalled();
  });
});
