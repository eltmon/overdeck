/**
 * PAN-2383: issue-aware tiered-execution resolution.
 *
 * Wraps the pure {@link resolveTieredExecutionEnabled} core with the two
 * lookups it cannot do itself — the global `tiered_execution.enabled` flag and
 * the mutable per-issue record override — so callers only supply the issue id
 * and the plan metadata. Mirrors `resolveReviewMode` (review-agent.ts): read
 * the per-issue record via `readIssueRecordSync`, then apply
 * record > plan-metadata > global precedence.
 *
 * This lives in its own leaf module (not tier-table.ts) because tier-table is
 * imported by config-yaml at load time; importing config-yaml back into
 * tier-table would create a runtime import cycle.
 */

import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import { readIssueRecordSync, resolveProjectForIssue } from '../pan-dir/record.js';
import {
  resolveTieredExecutionEnabled,
  TieredExecutionConfigError,
  type TieredExecutionIssueOverride,
} from './tier-table.js';

export function readTieredExecutionOverrideForIssue(
  issueId: string,
): TieredExecutionIssueOverride | null {
  const project = resolveProjectForIssue(issueId);
  const override = project
    ? readIssueRecordSync(project, issueId)?.tieredExecutionOverride
    : undefined;
  if (override === undefined || override === null) return null;
  if (override === 'on' || override === 'off') return override;
  throw new TieredExecutionConfigError(
    `record tieredExecutionOverride must be one of on, off; got ${JSON.stringify(override)}`,
  );
}

/**
 * Is tiered execution (Standing Crew) enabled for this issue, honoring the
 * mutable per-issue record override, then the immutable plan-metadata override,
 * then the global flag? An invalid stored record override throws
 * TieredExecutionConfigError (fail-loud) rather than silently inheriting.
 */
export function resolveTieredExecutionEnabledForIssue(
  issueId: string,
  planMetadata?: { [key: string]: unknown },
): boolean {
  const recordOverride = readTieredExecutionOverrideForIssue(issueId);
  const config = loadYamlConfig().config.tieredExecution ?? { enabled: false };
  return resolveTieredExecutionEnabled(config, planMetadata, recordOverride);
}
