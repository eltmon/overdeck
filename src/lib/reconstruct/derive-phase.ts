/**
 * PAN-1920: derive the dashboard pipeline phase from sources of truth only.
 *
 * The phase is a function of GitHub issue state, the per-issue git-tracked
 * record, and the GitHub PR reviewDecision. It never reads the SQLite cache.
 */

import type { PanIssueRecord } from '../pan-dir/record.js';

export type PipelinePhase = 'work' | 'review' | 'merge' | 'done';

export interface DerivePhaseArgs {
  /** True when the tracker issue itself is closed/done. */
  issueClosed: boolean;
  /** True when a PR exists for the feature branch. */
  hasPr: boolean;
  /** Per-issue git-tracked record (may be null while PAN-1919 is rolling out). */
  record: PanIssueRecord | null;
  /** GitHub `reviewDecision` from `gh pr view --json reviewDecision`. */
  reviewDecision: string | null;
}

/**
 * Derive the pipeline phase from sources.
 *
 * Rules (D3/D4):
 *   - issue closed on tracker → done
 *   - no PR → work
 *   - approved (record readyForMerge / reviewStatus passed / GitHub APPROVED) → merge
 *   - PR open but not approved → review
 */
export function derivePipelinePhase(args: DerivePhaseArgs): PipelinePhase {
  if (args.issueClosed) return 'done';
  if (!args.hasPr) return 'work';

  const approved =
    args.record?.pipeline?.readyForMerge === true ||
    args.record?.pipeline?.reviewStatus === 'passed' ||
    args.reviewDecision === 'APPROVED';

  return approved ? 'merge' : 'review';
}
