/**
 * The merge route rule (PAN-4753 D4, plan R1 as amended 2026-11-14).
 *
 * Where a ready PR goes: `per-pr` (the auto-merge scheduler merges it alone
 * after the cooldown) or `batch` (it waits for the next batch). First match
 * wins:
 *
 *   1. held for UAT (its label, else the project default, else global)
 *      => batch. A UAT hold always wins; priority never bypasses it;
 *   2. the merge train is off for the issue's project => per-pr;
 *   3. high priority ({@link isHighPriorityMerge}) => per-pr;
 *   4. dropped from a batch because the combined CI failed => per-pr;
 *   5. otherwise (train on, normal priority) => batch.
 *
 * The door policy (`auto-merge-door-policy.ts`) and auto-merge eligibility
 * both ask this, so the scheduler, the executor and `mergePathOwner` agree.
 */
import { isMergeTrainEnabledForProject, listUatGenerations } from '../overdeck/merge-sync.js';
import { resolve } from 'node:path';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';

/** Labels that make an issue high priority on their own (case-insensitive). */
export const HIGH_PRIORITY_LABELS: readonly string[] = ['critical', 'blocks-main', 'P0', 'urgent'];

/** Prefix of the heldOut reason the auto-promote tick writes when it drops a member. */
export const COMBINED_CI_DROP_PREFIX = 'combined CI failed';
/**
 * Prefix of the heldOut reason written when a window batch is dissolved
 * because no `CI` run appeared for its head: the project's CI does not run on
 * `uat/**` pushes. It also marks the project as having no batch CI.
 */
export const NO_BATCH_CI_PREFIX = 'no combined CI run';
/** Prefix of the heldOut reason written when a batch's CI run was cancelled and nothing replaced it. */
export const CANCELLED_BATCH_CI_PREFIX = 'combined CI run cancelled';
/**
 * Prefix of the heldOut reason written when no `CI` run appeared because the
 * batch head is a member's own commit (assembly fast-forwarded, PAN-5269).
 * This says nothing about the project's CI, so it does not mark the project
 * as having no batch CI.
 */
export const FAST_FORWARD_BATCH_HEAD_PREFIX = 'batch head is a member commit';
/** Every heldOut reason that sends a member back to the per-PR path. */
const DROP_PREFIXES = [COMBINED_CI_DROP_PREFIX, NO_BATCH_CI_PREFIX, CANCELLED_BATCH_CI_PREFIX, FAST_FORWARD_BATCH_HEAD_PREFIX];
/** How long a "no batch CI" mark keeps the project's PRs per-PR before batching is tried again. */
export const BATCH_CI_RETRY_MS = 24 * 60 * 60 * 1000;

/** How many of a project's newest invalidated generations count for {@link droppedFromBatch}. */
const DROP_LOOKBACK = 20;

/**
 * D4: high priority merges at once, on its own. A strike branch
 * (`strike/<id>`), an issue labeled `critical`, `blocks-main`, `P0` or
 * `urgent`, or one labeled both `substrate-improvement` and `bug`. A
 * `substrate-improvement` issue that is not a `bug` is normal priority.
 */
export function isHighPriorityMerge(input: { branch?: string | null; labels: readonly string[] }): boolean {
  if (/^strike\//i.test(input.branch ?? '')) return true;
  const labels = new Set(input.labels.map((label) => label.toLowerCase()));
  if (HIGH_PRIORITY_LABELS.some((label) => labels.has(label.toLowerCase()))) return true;
  return labels.has('substrate-improvement') && labels.has('bug');
}

export type MergeRoute = 'per-pr' | 'batch';

export interface MergeRouteInput {
  heldForUat: boolean;
  trainOn: boolean;
  highPriority: boolean;
  droppedFromBatch: boolean;
}

/** The route rule; see the module doc for the order. Pure. */
export function mergeRouteFor(input: MergeRouteInput): MergeRoute {
  if (input.heldForUat) return 'batch';
  if (!input.trainOn) return 'per-pr';
  if (input.highPriority) return 'per-pr';
  if (input.droppedFromBatch) return 'per-pr';
  return 'batch';
}

/** The door's refusal text for a batch-routed PR. */
export const BATCH_ROUTE_REASON = 'the merge train batches this PR; it merges with the next batch';

/**
 * D4: whether the issue was dropped from a batch: its combined CI failed, no
 * CI run ever appeared (including for a fast-forwarded batch head), or the run
 * was cancelled. The auto-promote tick
 * records the drop as a heldOut entry on the generation it invalidates, so
 * this reads stored generation rows and nothing else. A dropped member stays
 * on the per-PR path until it merges.
 */
export function droppedFromBatch(
  issueId: string,
  projectRoot: string | undefined,
  deps: { listInvalidated?: (projectRoot: string) => ReturnType<typeof listUatGenerations> } = {},
): boolean {
  if (!projectRoot) return false;
  const id = issueId.toUpperCase();
  const list = deps.listInvalidated
    ?? ((root: string) => listUatGenerations({ projectRoot: root, statuses: ['invalidated'], limit: DROP_LOOKBACK }));
  try {
    return list(projectRoot).some((gen) => gen.heldOut.some((held) =>
      held.issueId.toUpperCase() === id && DROP_PREFIXES.some((prefix) => held.reason.startsWith(prefix))));
  } catch {
    return false;
  }
}

/**
 * Whether the project has no batch CI: within the last
 * {@link BATCH_CI_RETRY_MS}, a window batch was dissolved because no `CI` run
 * appeared for its head. While true, the train does not batch this project's
 * PRs; they merge one at a time, as with the train off. Read from stored
 * generation rows only.
 */
export function projectLacksBatchCi(
  projectRoot: string | undefined,
  deps: { listInvalidated?: (projectRoot: string) => ReturnType<typeof listUatGenerations>; now?: () => number } = {},
): boolean {
  if (!projectRoot) return false;
  const now = (deps.now ?? Date.now)();
  const list = deps.listInvalidated
    ?? ((root: string) => listUatGenerations({ projectRoot: root, statuses: ['invalidated'], limit: DROP_LOOKBACK }));
  try {
    return list(projectRoot).some((gen) =>
      now - Date.parse(gen.updatedAt || gen.createdAt || '') < BATCH_CI_RETRY_MS
      && gen.heldOut.some((held) => held.reason.startsWith(NO_BATCH_CI_PREFIX)));
  } catch {
    return false;
  }
}

/**
 * Whether the merge train batches the issue's project: the effective flag
 * (the global master switch, then the project's opt-out) is on, and the
 * project has batch CI ({@link projectLacksBatchCi}). An issue no project
 * claims reads as train off, which routes it per-PR; the merge gate still
 * decides.
 */
export function issueTrainOn(issueId: string): boolean {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return false;
  if (!isMergeTrainEnabledForProject(getProjectSync(resolved.projectKey) ?? undefined)) return false;
  return !projectLacksBatchCi(resolved.projectPath ? resolve(resolved.projectPath) : undefined);
}

/** {@link droppedFromBatch} for the issue's own project. */
export function issueDroppedFromBatch(issueId: string): boolean {
  const projectPath = resolveProjectFromIssueSync(issueId)?.projectPath;
  // Generation rows store the resolved project path the reconciler runs with.
  return droppedFromBatch(issueId, projectPath ? resolve(projectPath) : undefined);
}
