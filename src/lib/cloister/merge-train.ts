/**
 * Merge-train entry point (PAN-1691).
 *
 * Called from the post-merge path after a feature lands on main. Gated by the
 * default-off `flywheel.merge_train_enabled` flag — when off this is a no-op, so
 * nothing git-mutating runs until an operator deliberately enables it.
 *
 * The real git/spawn deps are lazy-loaded only when the flag is on, so importing
 * this module (and unit-testing the gating) stays light and never pulls in the
 * agent-spawn machinery.
 */
import { isMergeTrainEnabled } from '../database/app-settings.js';
import { reconcileStaleSiblings, type ReconcileDeps, type SiblingOutcome } from './merge-train-reconciler.js';

export interface RunMergeTrainOptions {
  /** Override the flag check (tests). Defaults to the global merge-train flag. */
  enabled?: () => boolean;
  /** Inject reconcile deps (tests). Defaults to the real git/spawn wiring. */
  deps?: ReconcileDeps;
}

/**
 * Run the merge-train reconciler for the issue that just merged. No-op (returns
 * `[]`) when the merge-train flag is off — the safe default.
 */
export async function runMergeTrainReconcile(
  mergedIssueId: string,
  opts: RunMergeTrainOptions = {},
): Promise<SiblingOutcome[]> {
  const enabled = (opts.enabled ?? isMergeTrainEnabled)();
  if (!enabled) return [];

  const deps = opts.deps ?? (await import('./merge-train-deps.js')).buildRealReconcileDeps();
  return reconcileStaleSiblings(mergedIssueId, deps);
}
