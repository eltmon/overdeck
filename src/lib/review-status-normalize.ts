import type { ReviewStatus } from './review-status.js';

export function normalizeReviewStatus(status: ReviewStatus): ReviewStatus {
  const shouldClearMergeNotes = status.mergeStatus === 'verifying' || status.mergeStatus === 'merged';
  const verificationSatisfied =
    status.verificationStatus === undefined ||
    status.verificationStatus === 'passed' ||
    status.verificationStatus === 'skipped';
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
