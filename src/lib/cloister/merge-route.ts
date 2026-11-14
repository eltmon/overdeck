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
 * D4: whether the issue was dropped from a batch because the batch's
 * combined CI failed. The auto-promote tick records the drop as a heldOut
 * entry on the generation it invalidates, so this reads stored generation
 * rows and nothing else. A dropped member stays on the per-PR path until it
 * merges.
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
      held.issueId.toUpperCase() === id && held.reason.startsWith(COMBINED_CI_DROP_PREFIX)));
  } catch {
    return false;
  }
}

/**
 * The effective merge-train flag for the issue's project (the global master
 * switch, then the project's opt-out). An issue no project claims reads as
 * train off, which routes it per-PR; the merge gate still decides.
 */
export function issueTrainOn(issueId: string): boolean {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return false;
  return isMergeTrainEnabledForProject(getProjectSync(resolved.projectKey) ?? undefined);
}

/** {@link droppedFromBatch} for the issue's own project. */
export function issueDroppedFromBatch(issueId: string): boolean {
  const projectPath = resolveProjectFromIssueSync(issueId)?.projectPath;
  // Generation rows store the resolved project path the reconciler runs with.
  return droppedFromBatch(issueId, projectPath ? resolve(projectPath) : undefined);
}
