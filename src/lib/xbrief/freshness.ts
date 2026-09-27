/**
 * Plan-freshness preflight (PAN-3917).
 *
 * An xBRIEF item's `metadata.files_scope` names the concrete files it
 * expects to touch. If the codebase moved on since planning — a file was
 * renamed, moved, or deleted — a work agent spawned from that plan spins on
 * paths that no longer exist. `checkPlanFreshness` is pure so it can be
 * tested without a filesystem; `pan start` calls it with real `existsSync`
 * right before spawning.
 *
 * A missing path is drift only when a commit on the workspace `HEAD`
 * deleted it after `plan.created`; a path that never existed on `HEAD`, or
 * that `HEAD` deleted before the plan was written, is a creation or a
 * restore and is not flagged (PAN-4212).
 */

import { join } from 'node:path';
import type { XBriefDocument } from './types.js';

export interface PlanFreshnessResult {
  /** Declared files_scope entries (relative to workspaceRoot) that do not exist on disk. */
  missing: string[];
  /** Number of non-glob files_scope entries checked. */
  checked: number;
}

/** Globs (`*`, `?`, `{`) name a pattern, not a concrete path — skip them. */
const GLOB_CHARS = /[*?{]/;

/**
 * A missing path is drift only when history deleted it after the plan was
 * written. Never deleted ⇒ the plan creates it; deleted before the plan ⇒
 * the plan restores it. With no plan baseline, any deletion counts as drift.
 */
export function isDriftedPath(deletedAtEpoch: number | null, planCreatedEpoch: number | null): boolean {
  if (deletedAtEpoch === null) return false;
  return planCreatedEpoch === null || deletedAtEpoch > planCreatedEpoch;
}

/** `plan.created` as epoch seconds, or null when absent or unparseable. */
export function planCreatedEpoch(plan: XBriefDocument): number | null {
  const ms = plan.plan.created ? Date.parse(plan.plan.created) : Number.NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * A plan's `files_scope` names both files an item edits and files it will
 * create. Callers pass `deletedAtEpoch` (the last deletion of a path on HEAD,
 * in epoch seconds, or null) so only drift is reported. Without it, every
 * missing path is reported.
 */
export function checkPlanFreshness(
  plan: XBriefDocument,
  workspaceRoot: string,
  existsFn: (path: string) => boolean,
  deletedAtEpoch?: (scope: string) => number | null,
): PlanFreshnessResult {
  const baseline = planCreatedEpoch(plan);
  const seen = new Set<string>();
  const missing: string[] = [];
  let checked = 0;

  for (const item of plan.plan.items) {
    for (const scope of item.metadata?.files_scope ?? []) {
      if (GLOB_CHARS.test(scope) || seen.has(scope)) continue;
      seen.add(scope);
      checked += 1;
      if (existsFn(join(workspaceRoot, scope))) continue;
      if (!deletedAtEpoch || isDriftedPath(deletedAtEpoch(scope), baseline)) {
        missing.push(scope);
      }
    }
  }

  return { missing, checked };
}

/** Plain-English refusal body for a stale plan, capped at 20 listed paths. */
export function formatPlanFreshnessRefusal(missing: string[], issueId: string): string {
  const shown = missing.slice(0, 20);
  const rest = missing.length - shown.length;
  const list = shown.map((path) => `  - ${path}`).join('\n');
  const more = rest > 0 ? `\n  ...and ${rest} more` : '';
  return `This plan was written against files that no longer exist. Re-plan with \`pan plan ${issueId}\`.\n\n${list}${more}`;
}
