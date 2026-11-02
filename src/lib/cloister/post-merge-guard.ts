/**
 * Process-local idempotence for the post-merge handoff (PAN-3917).
 *
 * The handoff used to be guarded by a file lock plus a `mergeStep === 'merged'`
 * read off the `review_status` row — a stored copy that outlived the process and
 * had to be repaired when it lied. What the handoff actually needs is much
 * smaller: don't run twice in one process, and join an in-flight run. Both are
 * process memory, reset when work restarts for the issue.
 *
 * Kept in its own module so the agent launcher can reset it without importing
 * the merge orchestration graph.
 */
export const completedPostMerge = new Set<string>();
export const postMergeInFlight = new Map<string, Promise<void>>();
/**
 * PAN-4801: issues whose merge already rolled the merge train. A lifecycle that
 * failed after the merge was verified runs again on the next door, and must
 * not roll the train a second time.
 */
export const mergeTrainRolled = new Set<string>();

export function resetPostMergeState(issueId: string): void {
  completedPostMerge.delete(issueId);
  postMergeInFlight.delete(issueId);
  mergeTrainRolled.delete(issueId);
}
