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
 * and the project does not hold for UAT. Anywhere else it answers `null`, and
 * the reconciler keeps today's semantics: assemble at once and let the
 * operator test and promote (D2), which is what Mind Your Now, GitLab and
 * polyrepo projects get.
 *
 * Two lanes (operator, 2026-11-14): in a project where the window applies, a
 * feature only a human may merge never delays the rest. The ready set is
 * split by {@link needsHumanMerge}. Features that may merge with no click go
 * to the **window lane**, whose batches are named `uat/<prefix>-train-…` and
 * merge on the window once their combined CI is green. The others (held for
 * UAT, a Deft human-merge hold, an auto-merge the operator cancelled, or one
 * that failed at the current head) go to the **UAT lane**, whose batches keep
 * today's names and today's semantics (the operator tests and promotes).
 *
 * The window needs batch CI: a workflow named `CI` that runs on `uat/**`
 * pushes. A project whose window batch got no CI run is marked
 * (`projectLacksBatchCi`, set by the auto-promote tick) and gets no window
 * for a day; its PRs merge one at a time instead.
 * Each lane sees only its own generations ({@link laneStore}), so assembling
 * one never supersedes, invalidates or trims the other.
 *
 * Ready-since is derived from the forge: the newest check-run completion on
 * the PR head in the cached open-PR listing (`readySinceFromRollup`). A PR
 * whose rollup reports no completion falls back to the first tick this
 * process saw it ready, keyed on its head so a new push restarts the clock.
 */
import { resolve } from 'node:path';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { PendingAutoMerge } from '../../../lib/overdeck/merge-sync.js';
import type { GenerationStorePort, ReadyFeature } from '../../../lib/cloister/uat-generation-engine.js';
import type { ReconcileResult } from '../../../lib/cloister/uat-reconciler.js';
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
import { latestAutoMergeAllowsSchedule } from '../../../lib/cloister/auto-merge-rearm.js';
import { projectLacksBatchCi } from '../../../lib/cloister/merge-route.js';
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
  /** The project has no batch CI; `projectLacksBatchCi` by default. */
  lacksBatchCi?: (projectRoot: string) => boolean;
  now?: () => number;
}

/** What {@link needsHumanMerge} reads besides the labels. */
export interface HumanMergeDeps extends Pick<BatchWindowDeps, 'getIssueLabels' | 'isRequireUatBeforeMerge' | 'listOpenPrs'> {
  /** PAN-4820: the Deft human-merge hold; `deftAutoMergeHold` by default. */
  deftHold?: (issueId: string) => Promise<string | null>;
  /** The issue's newest `pending_auto_merges` row; `getLatestAutoMerge` by default. */
  latestAutoMerge?: (issueId: string) => PendingAutoMerge | null;
}

export type BatchLane = 'window' | 'uat';

/** Codename label suffix of window-lane batches: `uat/pan-train-otter-1114`. */
export const WINDOW_LANE_LABEL_SUFFIX = 'train';

/** True for a window-lane batch name. Codenames are single words, never `train`. */
export function isWindowBatch(name: string): boolean {
  return /^uat\/[a-z0-9]+-train-/i.test(name);
}

/** The store as one lane sees it: `listChain` returns only that lane's generations. */
export function laneStore(store: GenerationStorePort, lane: BatchLane): GenerationStorePort {
  const mine = (name: string) => isWindowBatch(name) === (lane === 'window');
  return {
    ...store,
    listChain: (projectRoot, statuses) => store.listChain(projectRoot, statuses).filter((gen) => mine(gen.name)),
  };
}

/**
 * Why only a human may merge this feature, or null when the train may merge
 * it with no click. The one predicate for both the lane split and the
 * auto-promote tick, matching the `mergePathOwner` reasons that mean "a human
 * merges this": held for UAT (label, project, global); a Deft human-merge
 * hold; an auto-merge the operator cancelled (only the operator re-arms it);
 * a failed or blocked auto-merge the scheduler cannot re-arm at the PR's
 * current head. A read that fails answers "a human merges this", never the
 * automatic path.
 */
export async function needsHumanMerge(
  issueId: string,
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: HumanMergeDeps = {},
): Promise<string | null> {
  const id = issueId.toUpperCase();
  try {
    if (issueHeldForUat(id, config, deps)) return 'held for UAT';
    const deftHold = deps.deftHold ?? (await import('../../../lib/deft/policy.js')).deftAutoMergeHold;
    const hold = await deftHold(id);
    if (hold) return hold;
    const latestAutoMerge = deps.latestAutoMerge
      ?? (await import('../../../lib/overdeck/merge-sync.js')).getLatestAutoMerge;
    const latest = latestAutoMerge(id);
    if (latest?.status === 'cancelled') return 'auto-merge cancelled by the operator';
    if (latest?.status === 'failed' || latest?.status === 'blocked') {
      const rows = (await (deps.listOpenPrs ?? defaultListOpenPrs)(projectPath)) ?? [];
      const row = rows.find((r) => r.headRefName === `feature/${id.toLowerCase()}`);
      const pr = { url: row?.url ?? null, headSha: row?.headRefOid ?? null };
      if (!latestAutoMergeAllowsSchedule(latest, pr)) return `auto-merge ${latest.status} at this PR head`;
    }
    return null;
  } catch (err) {
    return `merge consent could not be read (${err instanceof Error ? err.message : String(err)})`;
  }
}

/** Split a ready set: features that may merge with no click (window lane) and the rest (UAT lane). */
export async function splitReadySetByLane(
  features: readonly ReadyFeature[],
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: HumanMergeDeps = {},
): Promise<Record<BatchLane, ReadyFeature[]>> {
  const split: Record<BatchLane, ReadyFeature[]> = { window: [], uat: [] };
  for (const feature of features) {
    split[(await needsHumanMerge(feature.issueId, projectPath, config, deps)) ? 'uat' : 'window'].push(feature);
  }
  return split;
}

/**
 * One result for a two-lane pass, for callers that report a project's
 * reconcile: the lane that did something wins (UAT lane first, as before),
 * and both lanes' invalidations are listed.
 */
export function combineLaneResults(window: ReconcileResult, uat: ReconcileResult): ReconcileResult {
  const primary = uat.action === 'idle' || uat.action === 'no-queue' ? window : uat;
  return { ...primary, invalidated: [...window.invalidated, ...uat.invalidated] };
}

/** Process-local first-seen fallback, keyed `<projectPath>|<ISSUE>|<head>`. */
const firstSeenReady = new Map<string, number>();

/** Test seam. */
export function _resetBatchWindowClockForTests(): void {
  firstSeenReady.clear();
}

/**
 * Whether the batch window and auto-promote apply to this project: GitHub,
 * monorepo, not a hold project, and not marked as having no batch CI
 * (`projectLacksBatchCi`). The train flag itself is the caller's check (the
 * reconciler and the promote tick both read it first).
 */
export function batchWindowAppliesToProject(
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: {
    forgeOf: (projectPath: string) => 'github' | 'gitlab';
    isRequireUatBeforeMerge?: () => boolean;
    lacksBatchCi?: (projectRoot: string) => boolean;
  },
): boolean {
  if (!config || config.workspace?.type === 'polyrepo') return false;
  if (deps.forgeOf(projectPath) !== 'github') return false;
  if (projectHoldsForUat(config, (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)())) return false;
  return !(deps.lacksBatchCi ?? ((root: string) => projectLacksBatchCi(root)))(resolve(projectPath));
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

/** The reconciler's `selectBatch` dep for one project's window lane. */
export function buildSelectBatch(
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: BatchWindowDeps = {},
): SelectBatch {
  const now = deps.now ?? Date.now;
  return async (batchReadySet, live) => {
    const forgeOf = deps.forgeOf ?? (await defaultForgeOf());
    if (!batchWindowAppliesToProject(projectPath, config, { ...deps, forgeOf })) return null;

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
