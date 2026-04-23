/**
 * Pure function: canonical_state → desired label set (PAN-805).
 *
 * Returns the set of workflow labels that *should* be present on a GitHub issue
 * for a given canonical state. The reconciler push step diffs this against the
 * actual remote label set to compute add/remove deltas.
 */

import type { CanonicalState } from './types.js';

/** Labels that are managed by the reconciler lifecycle. */
export const WORKFLOW_LABELS = [
  'in-progress',
  'in-review',
  'merged',
  'wontfix',
  'needs-close-out',
];

/**
 * Return the desired label set for a canonical state.
 * Only workflow labels are considered; other labels (bug, feature, etc.) are
 * left untouched by the reconciler.
 */
export function desiredLabels(state: CanonicalState): Set<string> {
  switch (state) {
    case 'todo':
      return new Set();
    case 'in_progress':
      return new Set(['in-progress']);
    case 'in_review':
      return new Set(['in-review']);
    case 'merged':
      return new Set(['merged']);
    case 'closed_wontfix':
      return new Set(['wontfix']);
    default:
      return new Set();
  }
}

/**
 * Compute the label deltas between the desired set and the actual remote set.
 * Returns { add: string[], remove: string[] } limited to workflow labels.
 */
export function computeLabelDeltas(
  desired: Set<string>,
  actual: string[],
): { add: string[]; remove: string[] } {
  const actualSet = new Set(actual);
  const add: string[] = [];
  const remove: string[] = [];

  for (const label of desired) {
    if (!actualSet.has(label)) {
      add.push(label);
    }
  }

  for (const label of WORKFLOW_LABELS) {
    if (actualSet.has(label) && !desired.has(label)) {
      remove.push(label);
    }
  }

  return { add, remove };
}
