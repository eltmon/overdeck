/**
 * Batch window wiring (PAN-4753 D4).
 *
 * The UAT reconciler asks `selectBatch` which batch-owned features to assemble
 * this tick. This module decides whether the batch window applies to the
 * project at all and, when it does, feeds `chooseBatch` the configured size
 * and wait plus each feature's ready-since time.
 *
 * The window applies only where the batch can merge with no human click: the
 * train is on (the reconciler checked), the project is GitHub and monorepo,
 * the project does not hold for UAT, and no batch-owned feature is held for
 * UAT by its own label. Anywhere else it answers `null`, and the reconciler
 * keeps today's semantics: assemble at once and let the operator test and
 * promote (D2), which is what Mind Your Now, GitLab and polyrepo projects get.
 *
 * Ready-since is derived from the forge: the newest check-run completion on
 * the PR head in the cached open-PR listing (`readySinceFromRollup`). A PR
 * whose rollup reports no completion falls back to the first tick this
 * process saw it ready, keyed on its head so a new push restarts the clock.
 */
import type { ProjectConfig } from '../../../lib/projects.js';
import type { ReadyFeature } from '../../../lib/cloister/uat-generation-engine.js';
import type { UatGeneration } from '../../../lib/overdeck/merge-sync.js';
import type { GhPrRow } from '../../../lib/overdeck/pr-listing.js';
import { chooseBatch, readySinceFromRollup, type BatchChoice } from '../../../lib/cloister/batch-window.js';
import { autoMergeFromLabels } from '../../../lib/cloister/auto-merge-eligibility.js';
import { projectAutoMergeDefault, projectHoldsForUat, shouldHoldForUat } from '../../../lib/cloister/auto-merge-policy.js';
import {
  getMergeTrainBatchSize,
  getMergeTrainBatchWaitMinutes,
  isFlywheelRequireUatBeforeMerge,
} from '../../../lib/overdeck/control-settings.js';
import { cachedIssueLabels } from './auto-merge-door-policy.js';

export type SelectBatch = (
  batchReadySet: readonly ReadyFeature[],
  live: readonly UatGeneration[],
) => Promise<BatchChoice | null>;

export interface BatchWindowDeps {
  forgeOf?: (projectPath: string) => 'github' | 'gitlab';
  isRequireUatBeforeMerge?: () => boolean;
  getIssueLabels?: (issueId: string) => readonly string[];
  listOpenPrs?: (projectPath: string) => Promise<readonly GhPrRow[] | null>;
  batchSize?: () => number;
  batchWaitMinutes?: () => number;
  now?: () => number;
}

/** Process-local first-seen fallback, keyed `<projectPath>|<ISSUE>|<head>`. */
const firstSeenReady = new Map<string, number>();

/** Test seam. */
export function _resetBatchWindowClockForTests(): void {
  firstSeenReady.clear();
}

/**
 * Whether the batch window and auto-promote apply to this project: GitHub,
 * monorepo, and not a hold project. The train flag itself is the caller's
 * check (the reconciler and the promote tick both read it first).
 */
export function batchWindowAppliesToProject(
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: { forgeOf: (projectPath: string) => 'github' | 'gitlab'; isRequireUatBeforeMerge?: () => boolean },
): boolean {
  if (!config || config.workspace?.type === 'polyrepo') return false;
  if (deps.forgeOf(projectPath) !== 'github') return false;
  return !projectHoldsForUat(config, (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)());
}

/** True when the issue is held for UAT by its label, its project, or the global flag. */
export function issueHeldForUat(
  issueId: string,
  config: ProjectConfig | undefined,
  deps: Pick<BatchWindowDeps, 'getIssueLabels' | 'isRequireUatBeforeMerge'> = {},
): boolean {
  return shouldHoldForUat(
    autoMergeFromLabels((deps.getIssueLabels ?? cachedIssueLabels)(issueId)),
    projectAutoMergeDefault(config),
    (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)(),
  );
}

async function defaultForgeOf(): Promise<(projectPath: string) => 'github' | 'gitlab'> {
  const { forgeForProject } = await import('./derived-issue-state.js');
  return forgeForProject;
}

async function defaultListOpenPrs(projectPath: string): Promise<readonly GhPrRow[] | null> {
  const { readOpenRepoPullRequests } = await import('../../../lib/overdeck/pr-listing.js');
  return readOpenRepoPullRequests(projectPath);
}

/** The reconciler's `selectBatch` dep for one project. */
export function buildSelectBatch(
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: BatchWindowDeps = {},
): SelectBatch {
  const now = deps.now ?? Date.now;
  return async (batchReadySet, live) => {
    const forgeOf = deps.forgeOf ?? (await defaultForgeOf());
    if (!batchWindowAppliesToProject(projectPath, config, { ...deps, forgeOf })) return null;
    if (batchReadySet.some((f) => issueHeldForUat(f.issueId, config, deps))) return null;

    const rows = (await (deps.listOpenPrs ?? defaultListOpenPrs)(projectPath)) ?? [];
    const at = now();
    const readySince = new Map<string, number>();
    for (const feature of batchReadySet) {
      const id = feature.issueId.toUpperCase();
      const row = rows.find((r) => r.headRefName === feature.branch);
      const derived = row ? readySinceFromRollup(row) : null;
      const key = `${projectPath}|${id}|${row?.headRefOid ?? ''}`;
      if (!firstSeenReady.has(key)) firstSeenReady.set(key, at);
      readySince.set(id, derived ?? firstSeenReady.get(key)!);
    }

    return chooseBatch({
      features: batchReadySet,
      readySince,
      live,
      size: (deps.batchSize ?? getMergeTrainBatchSize)(),
      waitMs: (deps.batchWaitMinutes ?? getMergeTrainBatchWaitMinutes)() * 60_000,
      now: at,
    });
  };
}
