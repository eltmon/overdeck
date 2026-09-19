/**
 * PAN-1920: derive the dashboard pipeline phase from sources of truth only.
 *
 * PAN-3917: the phase is a function of the tracker issue's state and the
 * GitHub PR's reviewDecision — the two owners of those facts. It never reads
 * the SQLite cache, and there is no longer a record to consult.
 */

export type PipelinePhase = 'work' | 'review' | 'merge' | 'done';

export interface DerivePhaseArgs {
  /** True when the tracker issue itself is closed/done. */
  issueClosed: boolean;
  /** True when a PR exists for the feature branch. */
  hasPr: boolean;
  /** GitHub `reviewDecision` from `gh pr view --json reviewDecision`. */
  reviewDecision: string | null;
}

/**
 * Derive the pipeline phase from sources.
 *
 * Rules (D3/D4):
 *   - issue closed on tracker → done
 *   - no PR → work
 *   - GitHub reviewDecision APPROVED → merge
 *   - PR open but not approved → review
 */
export function derivePipelinePhase(args: DerivePhaseArgs): PipelinePhase {
  if (args.issueClosed) return 'done';
  if (!args.hasPr) return 'work';

  const approved = args.reviewDecision === 'APPROVED';

  return approved ? 'merge' : 'review';
}
