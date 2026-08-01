import type { ReviewStatus } from './review-status-reconcile.js';
import type { ReviewStatusUpdate } from './workspace-anchor-drift.js';

type StuckFields = Pick<ReviewStatus, 'stuck' | 'stuckReason' | 'stuckAt' | 'stuckDetails'>;

export function clearSupersededReviewInfrastructureFailure(
  status: ReviewStatus | null,
): Partial<StuckFields> {
  if (status?.stuckReason !== 'review_infrastructure_failure') return {};
  return {
    stuck: false,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
  };
}

interface VerdictEvidenceHeadMismatch {
  gate: 'review' | 'test';
  evidenceHead: string;
  targetHead: string;
}

function findVerdictEvidenceHeadMismatch(
  status: ReviewStatus,
  update: ReviewStatusUpdate,
): VerdictEvidenceHeadMismatch | null {
  const terminalReview = update.reviewStatus !== undefined
    && ['passed', 'blocked', 'failed', 'skipped'].includes(update.reviewStatus);
  const reviewerEvidenceHeads = Object.values(update.reviewerVerdicts ?? {})
    .flatMap((verdict) => verdict?.atCommit ? [verdict.atCommit] : []);
  const reviewEvidenceHead = update.reviewedAtCommit ?? reviewerEvidenceHeads[0];
  if (
    terminalReview
    && reviewEvidenceHead
    && status.lastVerifiedCommit
    && reviewEvidenceHead !== status.lastVerifiedCommit
  ) {
    return { gate: 'review', evidenceHead: reviewEvidenceHead, targetHead: status.lastVerifiedCommit };
  }

  const terminalTest = update.testStatus !== undefined
    && ['passed', 'failed'].includes(update.testStatus);
  if (
    terminalTest
    && update.lastVerifiedCommit
    && status.reviewedAtCommit
    && update.lastVerifiedCommit !== status.reviewedAtCommit
  ) {
    return { gate: 'test', evidenceHead: update.lastVerifiedCommit, targetHead: status.reviewedAtCommit };
  }
  return null;
}

export function rejectVerdictEvidenceHeadMismatch(
  issueId: string,
  status: ReviewStatus,
  update: ReviewStatusUpdate,
  onReject: () => void,
): boolean {
  const mismatch = findVerdictEvidenceHeadMismatch(status, update);
  if (!mismatch) return false;
  console.warn(
    `[review-status] Rejecting ${mismatch.gate} verdict for ${issueId}: `
    + `evidence HEAD ${mismatch.evidenceHead} does not match target HEAD ${mismatch.targetHead}.`,
  );
  onReject();
  return true;
}
