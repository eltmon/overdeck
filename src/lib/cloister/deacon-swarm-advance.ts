import type { SlotReconcileResult } from '../agents/slot-reconcile.js';
import { gcMergedSlotsWithStatus } from './deacon-swarm-gc.js';
import { gcOrphanedSlots } from './deacon-swarm-orphan-gc.js';
import type { CoordinateSwarmSlotsDeps } from './deacon-swarm-types.js';

/**
 * Merged-slot GC + orphan GC, then the patrol's downstream advance
 * (finalization and next-wave dispatch) — but only when every merged slot was
 * actually freed (PAN-3695). An uncleared merged slot's item reads completed
 * in the plan overlay while its nested work is not yet integrated or pushed:
 * finalizing would request review of an incomplete branch, and dispatching
 * would start dependent items against a parent branch that lacks their
 * prerequisite. The GC retry on the next patrol is the recovery path.
 *
 * Lives in its own module because it composes deacon-swarm-gc and
 * deacon-swarm-orphan-gc — putting it in either would close a
 * circular-dependency edge back through deacon-swarm.
 */
export async function gcMergedSlotsAndAdvance(
  issueId: string,
  workspacePath: string,
  reconciled: SlotReconcileResult,
  deps: Parameters<typeof gcMergedSlotsWithStatus>[3] & Pick<CoordinateSwarmSlotsDeps, 'listSlotAssignments'>,
  advance: () => Promise<string[]>,
): Promise<string[]> {
  const gcResult = await gcMergedSlotsWithStatus(issueId, workspacePath, reconciled.merged, deps);
  const actions = [...gcResult.actions, ...await gcOrphanedSlots(issueId, workspacePath, reconciled, deps)];
  if (gcResult.uncleared.length > 0) {
    const held = gcResult.uncleared
      .map(slot => `slot ${slot.slotIndex} (item ${slot.itemId})`)
      .join(', ');
    actions.push(`[swarm] integration pending for ${issueId}: ${held} — finalization and next-wave dispatch held until nested merges and pushes complete`);
    return actions;
  }
  return [...actions, ...await advance()];
}
