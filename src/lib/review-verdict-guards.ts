interface ReviewGuardStatus {
  stuck?: boolean;
  stuckReason?: string;
  stuckAt?: string;
  stuckDetails?: string;
  reviewedAtCommit?: string;
  lastVerifiedCommit?: string;
}

interface ReviewGuardUpdate {
  reviewStatus?: string;
  testStatus?: string;
  reviewedAtCommit?: string;
  lastVerifiedCommit?: string;
  reviewerVerdicts?: Partial<Record<string, { atCommit?: string }>>;
}

type StuckFields = Pick<ReviewGuardStatus, 'stuck' | 'stuckReason' | 'stuckAt' | 'stuckDetails'>;

export function clearSupersededReviewInfrastructureFailure(
  status: ReviewGuardStatus | null,
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
  status: ReviewGuardStatus,
  update: ReviewGuardUpdate,
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
  status: ReviewGuardStatus,
  update: ReviewGuardUpdate,
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
