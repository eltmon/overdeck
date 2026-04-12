import type { ReviewStatus } from './review-status.js';

export function normalizeReviewStatus(status: ReviewStatus): ReviewStatus {
  const shouldClearMergeNotes = status.mergeStatus === 'verifying' || status.mergeStatus === 'merged';
  // Only block readyForMerge if verification explicitly FAILED.
  // 'pending'/'running' means "not yet run this cycle" — not a failure signal.
  // This must match the verificationSatisfied() function in review-status.ts.
  const verificationSatisfied = status.verificationStatus !== 'failed';
  const shouldClearReadyForMerge =
    status.mergeStatus === 'merged' ||
    status.reviewStatus !== 'passed' ||
    (status.testStatus !== 'passed' && status.testStatus !== 'skipped') ||
    !verificationSatisfied ||
    (status.uatStatus !== undefined && status.uatStatus !== 'passed');

  return {
    ...status,
    ...(shouldClearMergeNotes ? { mergeNotes: undefined } : {}),
    ...(shouldClearReadyForMerge ? { readyForMerge: false } : {}),
  };
}
