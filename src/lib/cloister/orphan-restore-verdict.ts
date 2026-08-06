/**
 * PAN-3512 — orphan-restore terminal verdicts go through the verdict write door.
 *
 * The two orphan-restore paths in deacon-review-status.ts rebuild a terminal
 * review verdict from history (a coordinator that exited after a completed
 * review, and a 'reviewing' row whose agent is gone). Both used to write the row
 * directly, so a restore whose evidence head disagreed with the row anchor was
 * dropped by the old guard with no event and no route to an honest next step.
 *
 * This adapter keeps the restore call sites flat: the caller keeps building the
 * update object it already built, and everything other than the verdict, its
 * notes, and the evidence anchor rides along in `extra` so stuck-clearing and
 * retry-counter fields land in the same atomic write. Dropping them would
 * deadlock the issue at passed+stuck.
 */
import { recordReviewVerdict, type ReviewVerdict, type VerdictOutcome } from './review-verdict-writer.js';
import type { HeadAnchor } from '../git-utils.js';

export async function recordOrphanRestoreVerdict(
  issueId: string,
  update: Record<string, unknown>,
): Promise<VerdictOutcome> {
  const { reviewStatus, reviewNotes, reviewedAtCommit, ...extra } = update;
  return recordReviewVerdict(issueId, {
    verdict: reviewStatus as ReviewVerdict,
    notes: reviewNotes as string | undefined,
    ...(reviewedAtCommit ? { evidenceHead: reviewedAtCommit as HeadAnchor } : {}),
    extra,
    writer: 'orphan-restore',
  });
}
