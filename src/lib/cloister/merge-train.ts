/**
 * Merge-train entry point (PAN-1691, PAN-1696).
 *
 * Called from the post-merge path after a feature lands on main. Gated by the
 * default-off `merge_train.enabled` flag (or per-project override in projects.yaml)
 * — when off this is a no-op, so nothing git-mutating runs until an operator
 * deliberately enables it.
 *
 * The real git/spawn deps are lazy-loaded only when the flag is on, so importing
 * this module (and unit-testing the gating) stays light and never pulls in the
 * agent-spawn machinery.
 */
import { isMergeTrainEnabledForProject } from '../database/app-settings.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { reconcileStaleSiblings, type ReconcileDeps, type SiblingOutcome } from './merge-train-reconciler.js';

export interface RunMergeTrainOptions {
  /** Override the flag check (tests). Defaults to checking the per-project override or global flag. */
  enabled?: () => boolean;
  /** Inject reconcile deps (tests). Defaults to the real git/spawn wiring. */
  deps?: ReconcileDeps;
}

/**
 * Run the merge-train reconciler for the issue that just merged. No-op (returns
 * `[]`) when the merge-train flag is off — the safe default. Respects per-project
 * overrides in projects.yaml.
 */
export async function runMergeTrainReconcile(
  mergedIssueId: string,
  opts: RunMergeTrainOptions = {},
): Promise<SiblingOutcome[]> {
  const enabled = opts.enabled ?? (() => {
    const project = resolveProjectFromIssueSync(mergedIssueId);
    return isMergeTrainEnabledForProject(project ?? undefined);
  });

  if (!enabled()) return [];

  const deps = opts.deps ?? (await import('./merge-train-deps.js')).buildRealReconcileDeps();
  return reconcileStaleSiblings(mergedIssueId, deps);
}
