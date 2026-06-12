/**
 * Merge-train reconciler (PAN-1691).
 *
 * When a feature merges to main, every *other* ready-for-merge branch is now
 * behind main. Left alone they go stale / CONFLICTING and strand — the cause of
 * PAN-1240 / PAN-1215 / PAN-1213 / PAN-1658. This reconciler is the automatic
 * janitor that runs right after a merge lands: rebase each ready sibling onto
 * the new main, re-verify the clean ones, and hand the genuinely-conflicting
 * ones to a resolving *agent* (never a human — the agent must understand what
 * BOTH features intended across BOTH changesets).
 *
 * The orchestration here is pure and dependency-injected so it is unit-testable
 * without touching git, the DB, or spawning agents. The real wiring + the
 * default-off `merge_train` flag live at the call site (the post-merge path).
 */

export type SiblingOutcome =
  /** Branch was already up to date with main — nothing to do. */
  | { issueId: string; result: 'unaffected' }
  /** Clean rebase onto the new main — re-verification was dispatched. */
  | { issueId: string; result: 'rebased' }
  /** Genuine conflict — a resolver agent was dispatched. */
  | { issueId: string; result: 'conflict' }
  /** Something failed for this sibling; the rest still proceed. */
  | { issueId: string; result: 'error'; error: string };

export type RebaseStatus = 'up-to-date' | 'clean' | 'conflict';

export interface ReconcileDeps {
  /** Ready-for-merge sibling issue IDs (excluding the one that just merged). */
  getReadySiblings: (mergedIssueId: string) => Promise<string[]> | string[];
  /** Rebase this sibling's feature branch onto the updated main. */
  rebaseSibling: (issueId: string) => Promise<{ status: RebaseStatus }>;
  /** Re-run review/test verification on a cleanly-rebased sibling. */
  reDispatchVerification: (issueId: string) => Promise<void> | void;
  /**
   * Dispatch an agent to resolve a rebase conflict. The agent must load and
   * reconcile what BOTH features intended — `mergedIssueId` is the feature that
   * just landed and conflicts with `issueId`.
   */
  dispatchConflictResolver: (issueId: string, mergedIssueId: string) => Promise<void> | void;
  log?: (msg: string) => void;
}

/**
 * Reconcile every ready sibling after `mergedIssueId` landed on main. Processes
 * siblings sequentially (one git rebase at a time, no contention) and never
 * throws — a failure on one sibling becomes an `error` outcome and the rest
 * proceed.
 */
export async function reconcileStaleSiblings(
  mergedIssueId: string,
  deps: ReconcileDeps,
): Promise<SiblingOutcome[]> {
  const log = deps.log ?? (() => {});
  const siblings = await deps.getReadySiblings(mergedIssueId);
  const outcomes: SiblingOutcome[] = [];

  for (const issueId of siblings) {
    try {
      const { status } = await deps.rebaseSibling(issueId);
      if (status === 'up-to-date') {
        outcomes.push({ issueId, result: 'unaffected' });
      } else if (status === 'clean') {
        await deps.reDispatchVerification(issueId);
        log(`[merge-train] ${issueId} rebased clean onto main(+${mergedIssueId}); re-verifying`);
        outcomes.push({ issueId, result: 'rebased' });
      } else {
        await deps.dispatchConflictResolver(issueId, mergedIssueId);
        log(`[merge-train] ${issueId} conflicts with ${mergedIssueId}; dispatched resolver agent`);
        outcomes.push({ issueId, result: 'conflict' });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`[merge-train] ${issueId} reconcile failed: ${error}`);
      outcomes.push({ issueId, result: 'error', error });
    }
  }

  return outcomes;
}
