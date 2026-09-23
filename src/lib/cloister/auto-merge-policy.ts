/**
 * Auto-merge policy resolution (PAN-1691 / PAN-1695).
 *
 * Decides whether an otherwise-eligible issue must be HELD for UAT, resolving
 * three tiers in order:
 *   1. per-issue `autoMerge` (true = auto, false = hold) — always wins
 *   2. per-project default (`auto_merge_default`: 'auto' | 'hold')
 *   3. global `flywheel.require_uat_before_merge`
 */
import { resolveProjectFromIssueSync, getProjectSync } from '../projects.js';

export type ProjectAutoMergeDefault = 'auto' | 'hold' | undefined;

/**
 * Returns true when the issue must be held for UAT (not auto-merged). Pure.
 */
export function shouldHoldForUat(
  autoMerge: boolean | undefined,
  projectDefault: ProjectAutoMergeDefault,
  globalRequireUat: boolean,
): boolean {
  if (autoMerge === true) return false; // explicit Auto overrides everything
  if (autoMerge === false) return true; // explicit Hold overrides everything
  if (projectDefault === 'auto') return false;
  if (projectDefault === 'hold') return true;
  return globalRequireUat; // no per-issue or per-project signal — follow global
}

/**
 * PAN-3965: whether a project holds merges for UAT — the tiers above minus the
 * per-issue flag: the project's `auto_merge_default`, else the global
 * `flywheel.require_uat_before_merge`. The merge-train reconciler keeps a batch
 * for a single ready feature only in a held project (it is the UAT stack).
 */
export function projectHoldsForUat(
  project: { auto_merge_default?: unknown } | null | undefined,
  globalRequireUat: boolean,
): boolean {
  return shouldHoldForUat(undefined, projectAutoMergeDefault(project), globalRequireUat);
}

/** A project config's `auto_merge_default`, normalized. */
export function projectAutoMergeDefault(
  project: { auto_merge_default?: unknown } | null | undefined,
): ProjectAutoMergeDefault {
  const d = project?.auto_merge_default;
  return d === 'auto' || d === 'hold' ? d : undefined;
}

/** Resolve the per-project auto-merge default for an issue, or undefined. */
export function getProjectAutoMergeDefault(issueId: string): ProjectAutoMergeDefault {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) return undefined;
  const config = getProjectSync(project.projectKey);
  const d = config?.auto_merge_default;
  return d === 'auto' || d === 'hold' ? d : undefined;
}
