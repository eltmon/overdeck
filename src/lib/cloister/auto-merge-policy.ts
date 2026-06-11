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

/** Resolve the per-project auto-merge default for an issue, or undefined. */
export function getProjectAutoMergeDefault(issueId: string): ProjectAutoMergeDefault {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) return undefined;
  const config = getProjectSync(project.projectKey);
  const d = config?.auto_merge_default;
  return d === 'auto' || d === 'hold' ? d : undefined;
}
