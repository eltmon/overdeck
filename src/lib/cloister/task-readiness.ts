/**
 * DAG-aware task readiness module for Cloister scheduling (PAN-388 Phase 4)
 *
 * Provides:
 * - isTaskReady(): checks if a vBRIEF item's hard dependencies are all done
 * - getUnblockedItems(): returns items newly unblocked after a task completes
 *
 * Gracefully degrades when no plan.vbrief.json exists — all tasks are ready.
 */

import { Effect } from 'effect';
import { readWorkspacePlanSync, readWorkspacePlan, type VBriefReadError } from '../vbrief/io.js';
import type { VBriefItemStatus } from '../vbrief/types.js';

const TERMINAL_STATUSES: VBriefItemStatus[] = ['completed', 'cancelled'];

/**
 * Returns true if the given vBRIEF item can be worked on — i.e., all items
 * that block it have reached a terminal status (completed or cancelled).
 *
 * When no plan exists for the workspace, returns true (no-op for legacy flows).
 */
export function isTaskReadySync(itemId: string, workspacePath: string): boolean {
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) return true; // No plan → all tasks ready

  // If item doesn't exist in this plan, don't block it (e.g., legacy bead not in vBRIEF)
  const itemExists = doc.plan.items.some(i => i.id === itemId);
  if (!itemExists) return true;

  // Find all items that block this task (type: 'blocks', edge.to === itemId)
  const blockerIds = doc.plan.edges
    .filter(e => e.type === 'blocks' && e.to === itemId)
    .map(e => e.from);

  if (blockerIds.length === 0) return true; // No blockers

  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));

  return blockerIds.every(blockerId => {
    const blocker = itemById.get(blockerId);
    if (!blocker) return true; // Unknown blocker — don't block
    return TERMINAL_STATUSES.includes(blocker.status);
  });
}

/**
 * Returns the list of item IDs that are newly unblocked after `justCompletedId`
 * reaches a terminal status.
 *
 * "Newly unblocked" means: the item was not ready before (had at least one
 * non-terminal blocker) and is now ready after this completion.
 *
 * Returns [] when no plan exists.
 */
export function getUnblockedItemsSync(workspacePath: string, justCompletedId: string): string[] {
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) return [];

  const itemById = new Map(doc.plan.items.map(i => [i.id, i]));

  // Find items that this completed item directly blocks
  const directlyUnblocking = doc.plan.edges
    .filter(e => e.type === 'blocks' && e.from === justCompletedId)
    .map(e => e.to);

  const unblocked: string[] = [];

  for (const candidateId of directlyUnblocking) {
    const candidate = itemById.get(candidateId);
    if (!candidate) continue;
    if (TERMINAL_STATUSES.includes(candidate.status)) continue; // Already done

    // Check all blockers of this candidate (excluding the just-completed one)
    const blockers = doc.plan.edges
      .filter(e => e.type === 'blocks' && e.to === candidateId)
      .map(e => e.from);

    const allBlockersTerminal = blockers.every(blockerId => {
      const blocker = itemById.get(blockerId);
      if (!blocker) return true;
      // The just-completed item counts as terminal even if status not yet written
      if (blockerId === justCompletedId) return true;
      return TERMINAL_STATUSES.includes(blocker.status);
    });

    if (allBlockersTerminal) {
      unblocked.push(candidateId);
    }
  }

  return unblocked;
}

// ─── Effect variants (PAN-1249) ──────────────────────────────────────────────

/**
 * Effect variant of {@link isTaskReadySync}. Reads the workspace plan asynchronously
 * via the typed Effect API. Returns `true` when the plan is missing or the item
 * is unknown (gracefully degrades for legacy flows).
 */
export const isTaskReady = (
  itemId: string,
  workspacePath: string,
): Effect.Effect<boolean, VBriefReadError> =>
  Effect.gen(function* () {
    const doc = yield* readWorkspacePlan(workspacePath);
    if (!doc) return true;

    const itemExists = doc.plan.items.some((i) => i.id === itemId);
    if (!itemExists) return true;

    const blockerIds = doc.plan.edges
      .filter((e) => e.type === 'blocks' && e.to === itemId)
      .map((e) => e.from);

    if (blockerIds.length === 0) return true;

    const itemById = new Map(doc.plan.items.map((i) => [i.id, i]));
    return blockerIds.every((blockerId) => {
      const blocker = itemById.get(blockerId);
      if (!blocker) return true;
      return TERMINAL_STATUSES.includes(blocker.status);
    });
  });

/**
 * Effect variant of {@link getUnblockedItemsSync}. Returns the list of item IDs
 * that are newly unblocked after `justCompletedId` reaches a terminal status.
 */
export const getUnblockedItems = (
  workspacePath: string,
  justCompletedId: string,
): Effect.Effect<string[], VBriefReadError> =>
  Effect.gen(function* () {
    const doc = yield* readWorkspacePlan(workspacePath);
    if (!doc) return [];

    const itemById = new Map(doc.plan.items.map((i) => [i.id, i]));
    const directlyUnblocking = doc.plan.edges
      .filter((e) => e.type === 'blocks' && e.from === justCompletedId)
      .map((e) => e.to);

    const unblocked: string[] = [];
    for (const candidateId of directlyUnblocking) {
      const candidate = itemById.get(candidateId);
      if (!candidate) continue;
      if (TERMINAL_STATUSES.includes(candidate.status)) continue;

      const blockers = doc.plan.edges
        .filter((e) => e.type === 'blocks' && e.to === candidateId)
        .map((e) => e.from);

      const allBlockersTerminal = blockers.every((blockerId) => {
        const blocker = itemById.get(blockerId);
        if (!blocker) return true;
        if (blockerId === justCompletedId) return true;
        return TERMINAL_STATUSES.includes(blocker.status);
      });

      if (allBlockersTerminal) unblocked.push(candidateId);
    }

    return unblocked;
  });
