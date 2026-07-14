/**
 * PAN-2385 — tiered-execution commit hooks for the swarm dispatch path.
 *
 * The tier-feed and tier-supervisor libraries shipped with PAN-1791/2222 but
 * had no production caller: commits landed and neither the standing crew nor
 * the subscribe-policy supervisor ever heard about them (found live during
 * the first Standing Crew run, PAN-2383). This module is the ignition.
 *
 * Fired from mergeReadySlots after a slot's bead commits merge into the
 * feature workspace:
 *   1. broadcastCommit — every live slot agent hears the rendered diff
 *      (ingestion-only; everyone-hears-everything per docs/TIERED-EXECUTION.md).
 *   2. shouldSupervise(item, subscribe) → deliverCommitForReview — the
 *      standing supervisor reviews per its subscribe policy. This is
 *      independent of supervisor.owns_inspection, which only routes
 *      `pan inspect`.
 *
 * Both hooks are best-effort: the commit has already landed, so a delivery
 * failure logs loudly and never blocks the merge loop.
 */

import { Effect } from 'effect';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { sessionExists } from '../tmux.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import { resolveTieredExecutionEnabled, type ValidatedTieredExecutionConfig } from '../agents/tier-table.js';
import { resolveTier } from '../agents/resolve-tier.js';
import { broadcastCommit } from '../agents/tier-feed.js';
import {
  deliverCommitForReview,
  loadPrdDraft,
  shouldSupervise,
  spawnTierSupervisor,
  supervisorAgentId,
} from '../agents/tier-supervisor.js';
import { listSlotAssignments } from '../agents/slot-reconcile.js';
import type { VBriefDocument, VBriefItem } from '../vbrief/types.js';

const execAsync = promisify(exec);

export interface FireTieredCommitHooksOptions {
  issueId: string;
  /** Feature workspace the slot branch just merged into (its HEAD is the commit). */
  workspacePath: string;
  /** The bead the merged commits implement. */
  item: VBriefItem;
  /** The merged plan view — plan.metadata carries the per-issue tiered override. */
  doc: VBriefDocument;
}

export interface FireTieredCommitHooksDeps {
  loadConfig: typeof loadYamlConfig;
  getHeadSha: (workspacePath: string) => Promise<string>;
  listAssignments: typeof listSlotAssignments;
  isSessionAlive: (sessionName: string) => Promise<boolean>;
  broadcast: typeof broadcastCommit;
  ensureSupervisor: typeof spawnTierSupervisor;
  deliverReview: typeof deliverCommitForReview;
  loadPrd: typeof loadPrdDraft;
}

const defaultDeps: FireTieredCommitHooksDeps = {
  loadConfig: loadYamlConfig,
  getHeadSha: async (workspacePath) =>
    (await execAsync('git rev-parse HEAD', { cwd: workspacePath })).stdout.trim(),
  listAssignments: listSlotAssignments,
  isSessionAlive: (sessionName) => Effect.runPromise(sessionExists(sessionName)),
  broadcast: broadcastCommit,
  ensureSupervisor: spawnTierSupervisor,
  deliverReview: deliverCommitForReview,
  loadPrd: loadPrdDraft,
};

/** Resolve the tier name a bead belongs to, for the feed header. Falls back to
 * the slot label when the tier table cannot resolve the item (fail-open here is
 * correct: the feed is informational and the commit has already landed). */
function tierNameForItem(
  item: VBriefItem | undefined,
  tiered: ValidatedTieredExecutionConfig,
  slotIndex: number,
): string {
  if (item) {
    try {
      return resolveTier(item, tiered).tierName;
    } catch {
      // fall through to the slot label
    }
  }
  return `slot-${slotIndex}`;
}

/**
 * Fire the commit feed + supervisor review for a bead whose commits just
 * merged into the feature workspace. Returns deacon action-log lines.
 */
export async function fireTieredCommitHooks(
  options: FireTieredCommitHooksOptions,
  deps: FireTieredCommitHooksDeps = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const { issueId, workspacePath, item, doc } = options;

  let tiered: ValidatedTieredExecutionConfig | undefined;
  try {
    tiered = deps.loadConfig().config.tieredExecution;
  } catch (err) {
    actions.push(`[tiered] skipped commit hooks for ${issueId}: config load failed (${err instanceof Error ? err.message : String(err)})`);
    return actions;
  }
  if (!tiered || !resolveTieredExecutionEnabled(tiered, doc.plan.metadata)) return actions;

  let sha: string;
  try {
    sha = await deps.getHeadSha(workspacePath);
  } catch (err) {
    actions.push(`[tiered] commit hooks for ${issueId} item ${item.id} could not resolve HEAD: ${err instanceof Error ? err.message : String(err)}`);
    return actions;
  }

  // ── 1. Broadcast to every live standing slot agent ────────────────────────
  try {
    const itemsById = new Map(doc.plan.items.map((planItem) => [planItem.id, planItem]));
    const assignments = deps.listAssignments(issueId, workspacePath);
    const listeners: Array<{ tierName: string; agentId: string }> = [];
    for (const assignment of assignments) {
      if (!assignment.agentId) continue;
      if (!(await deps.isSessionAlive(assignment.agentId))) continue;
      listeners.push({
        tierName: tierNameForItem(itemsById.get(assignment.itemId), tiered, assignment.slotIndex),
        agentId: assignment.agentId,
      });
    }
    if (listeners.length > 0) {
      const deliveries = await deps.broadcast({
        workspace: workspacePath,
        issueId,
        sha,
        itemTitle: item.title,
        itemId: item.id,
        tiers: listeners,
        feedConfig: tiered.feed,
      });
      const delivered = deliveries.filter((delivery) => delivery.result.ok).length;
      actions.push(`[tiered] broadcast commit ${sha.slice(0, 10)} (item ${item.id}) for ${issueId} to ${delivered}/${listeners.length} standing agents`);
    }
  } catch (err) {
    actions.push(`[tiered] feed broadcast FAILED for ${issueId} item ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. Supervisor review per subscribe policy ─────────────────────────────
  try {
    const supervisor = tiered.supervisor;
    if (supervisor && shouldSupervise(item, supervisor.subscribe)) {
      const agentId = supervisorAgentId(issueId);
      if (!(await deps.isSessionAlive(agentId))) {
        await deps.ensureSupervisor(issueId, supervisor, { workspace: workspacePath });
        actions.push(`[tiered] spawned standing supervisor ${agentId} for ${issueId}`);
      }
      const prdMarkdown = await deps.loadPrd(workspacePath, issueId).catch(() => undefined);
      await deps.deliverReview({
        supervisorAgentId: agentId,
        workspacePath,
        issueId,
        item,
        sha,
        itemId: item.id,
        prdMarkdown,
      });
      actions.push(`[tiered] supervisor review dispatched for ${issueId} item ${item.id} (subscribe=${supervisor.subscribe})`);
    }
  } catch (err) {
    actions.push(`[tiered] supervisor review FAILED for ${issueId} item ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return actions;
}
