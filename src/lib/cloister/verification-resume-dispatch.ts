/**
 * PAN-4622: the dispatch-time check for a review request that boot adoption
 * resumed.
 *
 * Boot adoption (`verification-boot-adoption.ts`) re-enters the review door for
 * a request Overdeck already accepted, so it skips the door's dirty-tree
 * refusal: a worker that is installing dependencies at boot can leave tracked
 * files modified for a moment, and refusing there made the gates run again
 * from scratch. The check moves here, to the moment before the push. The head
 * must still be the head the pass was taken on (`dispatchOwed.head`) and the
 * tree must be clean. Otherwise nothing is pushed or dispatched, the reason is
 * journalled as `review.resume-declined`, and deacon-lite's
 * `recoverUndispatchedReviews` re-requests the review through the normal door,
 * as it does for an undispatched `verification.passed`. See
 * docs/PIPELINE-GATES.md.
 */
import { appendPipelineEntry } from './pipeline-journal.js';
import { snapshotWorkspaceHeads } from '../git-utils.js';
import { resolveWorkspaceRepoRoots } from '../project-repos.js';
import { primaryShaFromAnchor } from './verified-head.js';
import { readVerificationDispatchOwed } from './verification-worker-supervisor.js';

/**
 * Whether the resumed request may push and dispatch. `dirtyError` reads the
 * working tree and must fail closed: an unreadable tree is an error string,
 * never `null`.
 */
export async function confirmResumedDispatch(
  issueId: string,
  workspacePath: string,
  dirtyError: () => Promise<string | null>,
): Promise<boolean> {
  const owed = readVerificationDispatchOwed(issueId);
  const head = await snapshotWorkspaceHeads(issueId, workspacePath).catch(() => undefined);
  const reason = !owed
    ? 'no verified head is recorded for the resumed request'
    : head !== owed.head
      ? 'the head moved after verification passed'
      : await dirtyError()
        ? 'the working tree has uncommitted changes'
        : null;
  if (!reason) return true;

  const canonicalIssueId = issueId.toUpperCase();
  const verifiedHead = owed
    ? primaryShaFromAnchor(owed.head, resolveWorkspaceRepoRoots(issueId, workspacePath)[0]?.repoKey)?.slice(0, 8)
    : undefined;
  console.warn(`[verification-adoption] ${canonicalIssueId}: review not dispatched — ${reason}; deacon-lite re-requests it`);
  appendPipelineEntry(workspacePath, {
    type: 'review.resume-declined',
    issueId: canonicalIssueId,
    source: 'verification-adoption',
    data: { reason, ...(verifiedHead ? { head: verifiedHead } : {}) },
  });
  return false;
}
