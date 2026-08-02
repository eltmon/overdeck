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
 * Built from durable lenses only (L1–L4 + L6-spec + L7-record), so membership survives the cutover and
 * a fresh `~/.overdeck` (no `state.json`) by construction:
 *
 *   L1  open PR              · L1-merged  a merged PR exists (the merge oracle)
 *   L2  unmerged branch      · `git merge-tree` vs main (blind to squash — always
 *                              paired with L1-merged, which wins)
 *   L3  issue open           · L4  current-phase label
 *   L6-spec  xBRIEF exists   · durable plan on the `overdeck-state` branch
 *   L7-record  close-out record  · pipeline.closedOut === true via the record door
 *
 * L5 (agents / DB / state.json) is a *liveness accelerator* only — it can
 * annotate "is an agent running right now," but it NEVER decides membership.
 */

/** Durable lens signals for one issue. Gather these from the tracker, forge, and git, never L5. */
import type { PipelineBucket } from '@overdeck/contracts';

export type { PipelineBucket } from '@overdeck/contracts';

export const PLANNED_BACKLOG_SPEC_ONLY_REASON = 'open issue with an xBRIEF spec but no branch/PR — planned work whose plan encodes code paths that age; needs starting or re-planning';

export interface IssueLensSignals {
  issueId: string;
  /** L3 — the tracker issue state is open. */
  issueOpen: boolean;
  /** L1 — an open PR whose head branch is `feature/<id>` or `strike/<id>`. */
  hasOpenPr: boolean;
  /** L1-merged — a merged PR exists for this issue/branch (the squash-merge oracle). */
  hasMergedPr: boolean;
  /** A `feature/<id-lowercase>` or `strike/<id-lowercase>` convention branch exists (local or remote). */
  hasConventionBranch: boolean;
  /**
   * L2 — `git merge-tree` reports the branch is NOT in main (commit lineage).
   * Only meaningful when {@link hasConventionBranch}; blind to squash-merges, so
   * the resolver always trusts {@link hasMergedPr} over this.
   */
  branchUnmerged: boolean;
  /**
   * L2-work — positive non-PR merge evidence (PAN-2887): a convention branch is
   * contained in main AND its tip sits OFF main's first-parent line, i.e. the
   * branch carried unique commits that arrived via a merge. A branch whose tip
   * IS a first-parent main commit is just a pointer at main (freshly created or
   * never started) — zero unique work, NOT evidence anything landed.
   */
  hasMergedBranchWork: boolean;
  /** L4 — current-phase label (in-review/in-progress/planned/verifying-on-main/…), else null. */
  phaseLabel: string | null;
  /** L6-spec — a durable xBRIEF spec exists on `overdeck-state`; gather via `findSpecByIssue`, never the DB. */
  hasXbriefSpec: boolean;
  /** Durable Definition-of-Ready signal from the issue's `ready` label. */
  explicitlyReady: boolean;
  /** L7-record — a terminal close-out record exists (pipeline.closedOut === true via the record door, durable only). */
  hasTerminalCloseOut: boolean;
}

export interface PipelineMembership {
  issueId: string;
  /** Whether this issue is in the pipeline (true unless `clean_terminal`). */
  inPipeline: boolean;
  bucket: PipelineBucket;
  /** Human-readable reason(s) the issue landed in its bucket. */
  reasons: string[];
  /** Whether the durable phase label disagrees with the issue/PR lifecycle. */
  labelDrift: 'stale_present' | 'stale_absent' | null;
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
  const result = (bucket: PipelineBucket, reason: string): PipelineMembership => {
    // Canonical phase labels from STALE_PIPELINE_LABELS in label-reconciler.ts:
    // verifying-on-main, planning, in-progress, in-review, in-planning.
    const labelDrift = s.phaseLabel !== null && (bucket === 'clean_terminal' || !s.issueOpen)
      ? 'stale_present'
      : s.issueOpen && s.hasOpenPr && s.phaseLabel === null
        ? 'stale_absent'
        : null;
    return {
      issueId: s.issueId,
      inPipeline: bucket !== 'clean_terminal',
      bucket,
      reasons: [reason],
      labelDrift,
      lenses,
    };
  };

  if (!s.issueOpen) {
    // Closed ⇒ terminal, regardless of lingering state — except an open PR, which
    // is a live mergeable artifact that needs closing.
    if (s.hasOpenPr) {
      // Closed with open PR: reclassify to clean_terminal if a terminal close-out
      // record exists (L7-record), since the record confirms durable closure intent.
      // The still-open PR is residue to be closed on the forge.
      if (s.hasTerminalCloseOut) {
        return result(
          'clean_terminal',
          'issue closed out (durable close-out record) — the still-open PR is residue; close it on the forge',
        );
      }
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
    return result('planned_backlog', 'open issue with an unmerged convention branch (feature/ or strike/) but no PR — needs a PR or disposition');
  }
  if (s.hasConventionBranch) {
    if (s.hasMergedBranchWork) {
      // Branch exists, its unique commits are contained in main (merge lineage),
      // but no merged PR was found — work landed via a non-PR path (merge-agent /
      // direct commit, §2e); the open issue still needs closing out.
      return result('post_merge_limbo', 'open issue whose branch work is contained in main but with no merged PR — landed via a non-PR path; run close-out');
    }
    // PAN-2887: a contained branch with NO unique commits is a branch that was
    // created and never (or not yet) worked — every `pan start` sits here from
    // workspace prep until the first commit. Absence of unmerged work is NOT
    // evidence of a landing; only hasMergedBranchWork is. (Known blind spot:
    // a fast-forward-landed branch is indistinguishable from a fresh pointer
    // and classifies as backlog — visible and safe, unlike false close-out.)
    return result('planned_backlog', 'open issue with a convention branch but no unique commits — created, work not yet landed; needs work or disposition');
  }
  if (s.hasXbriefSpec) {
    return result(
      'planned_backlog',
      PLANNED_BACKLOG_SPEC_ONLY_REASON,
    );
  }
  if (s.explicitlyReady) {
    return result('planned_backlog', 'open issue carries the explicit ready label — ready to start');
  }
  return result('clean_terminal', 'open issue with no branch and no PR — backlog, never started');
}
