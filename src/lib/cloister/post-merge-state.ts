/**
 * Process-local state for the idempotent post-merge lifecycle.
 *
 * Spawn resets this state when work restarts, so keeping it separate from the
 * merge orchestration prevents the agent launcher from importing that module.
 */
export const completedPostMerge = new Set<string>();
export const postMergeInFlight = new Map<string, Promise<void>>();

export function resetPostMergeState(issueId: string): void {
  completedPostMerge.delete(issueId);
  postMergeInFlight.delete(issueId);
}
