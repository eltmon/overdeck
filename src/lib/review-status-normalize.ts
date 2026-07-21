import { Effect } from 'effect';
import type { ReviewStatus } from './review-status.js';

export function normalizeReviewStatusSync(status: ReviewStatus): ReviewStatus {
  const shouldClearMergeNotes = status.mergeStatus === 'verifying' || status.mergeStatus === 'merged';
  const shouldClearReadyForMerge =
    status.mergeStatus === 'merged' ||
    // PAN-1862 (FR-16): a skipped review (mode none) passes the gate like passed.
    (status.reviewStatus !== 'passed' && status.reviewStatus !== 'skipped') ||
    (status.testStatus !== 'passed' && status.testStatus !== 'skipped') ||
    (status.uatStatus !== undefined && status.uatStatus !== 'passed') ||
    ((status.blockerReasons?.length ?? 0) > 0);

  return {
    ...status,
    ...(shouldClearMergeNotes ? { mergeNotes: undefined } : {}),
    ...(shouldClearReadyForMerge ? { readyForMerge: false } : {}),
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Normalize a review status record (clear stale fields). Pure. */
export const normalizeReviewStatus = (
  status: ReviewStatus,
): Effect.Effect<ReviewStatus> => Effect.sync(() => normalizeReviewStatusSync(status));
