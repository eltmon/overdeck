import { rehydrateHeadAnchor } from '../git-utils.js';
import { getReviewStatusSync, setReviewStatusSync } from '../review-status.js';
import type { ReviewStatus } from '../review-status.js';
import type { UatGeneration, UatGenerationMember } from '../overdeck/merge-types.js';
import type { ReviewStatusUpdate } from '../workspace-anchor-drift.js';

export interface UatPromotionEvidence {
  generationName: string;
  mergeSha?: string;
}

/** Build the verification verdict recorded when an operator promotes a tested UAT batch. */
export function buildUatPromotionStamp(
  current: Pick<ReviewStatus, 'verificationStatus'> | null,
  member: UatGenerationMember,
  evidence: UatPromotionEvidence,
): ReviewStatusUpdate {
  if (current?.verificationStatus === 'passed' || current?.verificationStatus === 'skipped') {
    return {};
  }

  const shortSha = evidence.mergeSha?.slice(0, 9);
  const promotedAt = shortSha ? ` promoted to main at ${shortSha}` : ' promoted to main';
  return {
    verificationStatus: 'passed',
    verificationNotes: `uat-promotion: operator UAT of batch ${evidence.generationName}${promotedAt} (PAN-3114)`,
    ...(member.headSha ? { lastVerifiedCommit: rehydrateHeadAnchor(member.headSha) } : {}),
  };
}

/** Record UAT-promotion verification verdicts through the review-status write door. */
export function recordUatPromotionVerdicts(gen: UatGeneration, mergeSha: string): string[] {
  const stampedIssueIds: string[] = [];

  for (const member of gen.members) {
    const current = getReviewStatusSync(member.issueId);
    const stamp = buildUatPromotionStamp(current, member, {
      generationName: gen.name,
      mergeSha,
    });
    if (Object.keys(stamp).length === 0) continue;

    setReviewStatusSync(member.issueId, stamp, current ?? undefined);
    stampedIssueIds.push(member.issueId);
    console.log(`✓ Recorded UAT-promotion verification verdict for ${member.issueId} (${gen.name} at ${mergeSha.slice(0, 9)})`);
  }

  return stampedIssueIds;
}
