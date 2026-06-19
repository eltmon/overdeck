/**
 * Single authoritative pipeline-membership resolver (PAN-1966 / PAN-1980).
 *
 * "In the pipeline" is one fact, computed one way, from durable lenses only.
 * This replaces the 5 divergent membership views (resource-discovery, lifecycle,
 * pan-pending, enumerate-in-flight, flywheel) that each picked a different subset
 * of signals and disagreed (sidequest §2a). Every surface should classify issues
 * through {@link resolvePipelineMembership} so they all agree by construction.
 *
 * The definition (operator framing — the pipeline is an *exception queue*):
 *
 *   An issue is "in the pipeline" iff its all-up state is NOT provably a clean
 *   terminal state. The pipeline is everything that needs attention to reach a
 *   correct, consistent end state — not just the happy-path in-flight set.
 *
 * Built from durable lenses only (L1–L4), so membership survives the cutover and
 * a fresh `~/.overdeck` (no `state.json`) by construction:
 *
 *   L1  open PR              · L1-merged  a merged PR exists (the merge oracle)
 *   L2  unmerged branch      · `git merge-tree` vs main (blind to squash — always
 *                              paired with L1-merged, which wins)
 *   L3  issue open           · L4  current-phase label
 *
 * L5 (agents / DB / state.json) is a *liveness accelerator* only — it can
 * annotate "is an agent running right now," but it NEVER decides membership.
 */

/** Durable lens signals for one issue. Gather these from GitHub + git, never L5. */
export interface IssueLensSignals {
  issueId: string;
  /** L3 — the GitHub issue state is open. */
  issueOpen: boolean;
  /** L1 — an open PR whose head branch is `feature/<id>`. */
  hasOpenPr: boolean;
  /** L1-merged — a merged PR exists for this issue/branch (the squash-merge oracle). */
  hasMergedPr: boolean;
  /** A `feature/<id-lowercase>` convention branch exists (local or remote). */
  hasConventionBranch: boolean;
  /**
   * L2 — `git merge-tree` reports the branch is NOT in main (commit lineage).
   * Only meaningful when {@link hasConventionBranch}; blind to squash-merges, so
   * the resolver always trusts {@link hasMergedPr} over this.
   */
  branchUnmerged: boolean;
  /** L4 — current-phase label (in-review/in-progress/planned/verifying-on-main/…), else null. */
  phaseLabel: string | null;
}

export type PipelineBucket =
  | 'in_flight'
  | 'zombie_pr'
  | 'post_merge_limbo'
  | 'planned_backlog'
  | 'clean_terminal';

export interface PipelineMembership {
  issueId: string;
  /** Whether this issue is in the pipeline (true unless `clean_terminal`). */
  inPipeline: boolean;
  bucket: PipelineBucket;
  /** Human-readable reason(s) the issue landed in its bucket. */
  reasons: string[];
  /** The durable lenses as evaluated for this issue (for display / debugging). */
  lenses: {
    L1_openPr: boolean;
    L2_unmergedBranch: boolean;
    L3_issueOpen: boolean;
    L4_phaseLabel: string | null;
  };
}

/**
 * Classify a single issue's pipeline membership from its durable lens signals.
 *
 * Decisions (see PAN-1980):
 *  - A closed issue is subtracted from the pipeline regardless of lingering
 *    branch/label/agent/workspace state (§2d), EXCEPT a still-open PR — a live,
 *    mergeable artifact that must be closed (`zombie_pr`).
 *  - L1-merged is the merge oracle; a squash-merged branch that L2 still calls
 *    "unmerged" is treated as merged.
 *  - An open issue with a branch but no PR is `planned_backlog` (in the pipeline,
 *    needs a PR or disposition) — distinct from `in_flight` so it does not
 *    inflate throughput.
 */
export function resolvePipelineMembership(s: IssueLensSignals): PipelineMembership {
  // A branch only counts as "live unmerged work" when L2 says unmerged AND no
  // merged PR exists (squash-merge pairing — L1-merged wins over L2).
  const branchLive = s.hasConventionBranch && s.branchUnmerged && !s.hasMergedPr;
  const lenses = {
    L1_openPr: s.hasOpenPr,
    L2_unmergedBranch: branchLive,
    L3_issueOpen: s.issueOpen,
    L4_phaseLabel: s.phaseLabel,
  };
  const result = (bucket: PipelineBucket, reason: string): PipelineMembership => ({
    issueId: s.issueId,
    inPipeline: bucket !== 'clean_terminal',
    bucket,
    reasons: [reason],
    lenses,
  });

  if (!s.issueOpen) {
    // Closed ⇒ terminal, regardless of lingering state — except an open PR, which
    // is a live mergeable artifact that needs closing.
    if (s.hasOpenPr) {
      return result('zombie_pr', 'issue is closed but a PR is still open — close/reconcile the PR');
    }
    return result(
      'clean_terminal',
      'issue closed; no open PR — terminal (any leftover branch/label/agent is cleanup, not pipeline)',
    );
  }

  // Open issue:
  if (s.hasOpenPr) {
    return result('in_flight', 'open issue with an open PR — active work');
  }
  if (s.hasMergedPr) {
    return result('post_merge_limbo', 'open issue with a merged PR — merged but never closed out; run close-out');
  }
  if (branchLive) {
    return result('planned_backlog', 'open issue with an unmerged feature branch but no PR — needs a PR or disposition');
  }
  if (s.hasConventionBranch) {
    // Branch exists, L2 says it is already in main, but no merged PR was found —
    // work landed via a non-PR path (merge-agent / direct commit, §2e); the open
    // issue still needs closing out.
    return result('post_merge_limbo', 'open issue whose branch is already in main but with no merged PR — landed via a non-PR path; run close-out');
  }
  return result('clean_terminal', 'open issue with no branch and no PR — backlog, never started');
}
