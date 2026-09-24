/**
 * Plan-freshness preflight (PAN-3917).
 *
 * An xBRIEF item's `metadata.files_scope` names the concrete files it
 * expects to touch. If the codebase moved on since planning — a file was
 * renamed, moved, or deleted — a work agent spawned from that plan spins on
 * paths that no longer exist. `checkPlanFreshness` is pure so it can be
 * tested without a filesystem; `pan start` calls it with real `existsSync`
 * right before spawning.
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
 * A plan's `files_scope` names both files an item edits and files it will
 * create. A path that is absent AND was never part of the repository is a
 * file the plan intends to create, not evidence of drift, so callers pass
 * `isNewFile` (typically "no git history for this path") to exclude it.
 */
export function checkPlanFreshness(
  plan: XBriefDocument,
  workspaceRoot: string,
  existsFn: (path: string) => boolean,
  isNewFile: (scope: string) => boolean = () => false,
): PlanFreshnessResult {
  const seen = new Set<string>();
  const missing: string[] = [];
  let checked = 0;

  for (const item of plan.plan.items) {
    for (const scope of item.metadata?.files_scope ?? []) {
      if (GLOB_CHARS.test(scope) || seen.has(scope)) continue;
      seen.add(scope);
      checked += 1;
      if (!existsFn(join(workspaceRoot, scope)) && !isNewFile(scope)) {
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
