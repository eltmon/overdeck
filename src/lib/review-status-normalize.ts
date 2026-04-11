import type { ReviewStatus } from './review-status.js';

export function normalizeReviewStatus(status: ReviewStatus): ReviewStatus {
  const shouldClearMergeNotes = status.mergeStatus === 'verifying' || status.mergeStatus === 'merged';
  const shouldClearReadyForMerge = status.mergeStatus === 'merged';

  return {
    ...status,
    ...(shouldClearMergeNotes ? { mergeNotes: undefined } : {}),
    ...(shouldClearReadyForMerge ? { readyForMerge: false } : {}),
  };
}
