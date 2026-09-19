import { existsSync } from 'node:fs';
import type { ReconciledSlotItem, SlotReconcileResult } from './swarm-slot-reconcile.js';
import {
  clearSwarmSlotCompletion,
  writeSwarmSupersededAttempt,
  type SwarmSlotState,
  type SwarmSupersededAttempt,
} from './deacon-swarm-record.js';
import type { PersistedTaskOperation } from '../xbrief/dag.js';
import type { XBriefDocument } from '../xbrief/types.js';


/** Patrol GC never removes forensic attempts; configured issue close-out owns teardown. */
export const SWARM_SUPERSEDED_RETENTION = 'issue-close-out' as const;

export interface FailedSlotArchiveDeps {
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => Promise<void>;
}

interface FailedSlotRequeueDeps extends FailedSlotArchiveDeps {
  applyTaskOperationToPlanFile: (
    issueId: string,
    operation: PersistedTaskOperation,
    workspacePath?: string,
  ) => Promise<unknown>;
}
interface ClassifiedSlot extends ReconciledSlotItem { lifecycle: string; reason?: string }

export function nextSwarmSlotIndex(swarm: SwarmSlotState | null | undefined, reconciled: SlotReconcileResult): number {
  return Math.max(0,
    ...reconciled.branches.map(value => value.slotIndex),
    ...reconciled.agents.map(value => value.slotIndex),
    ...reconciled.inFlight.map(value => value.slotIndex),
    ...(swarm?.slotAssignments ?? []).map(value => value.slotIndex),
    ...(swarm?.supersededAttempts ?? []).map(value => value.slotIndex),
  ) + 1;
}

export async function archiveFailedSwarmSlot(
  issueId: string,
  workspacePath: string,
  slot: ReconciledSlotItem & { reason?: string },
  deps: FailedSlotArchiveDeps,
  now = new Date(),
): Promise<SwarmSupersededAttempt> {
  const normalized = issueId.toUpperCase();
  const suffix = now.toISOString().replace(/[-:.TZ]/g, '');
  const archivedStem = `slot-${slot.slotIndex}-failed-${suffix}`;
  const oldWorktree = `${workspacePath}-slot-${slot.slotIndex}`;
  const archivedWorktree = `${workspacePath}-${archivedStem}`;
  const oldBranch = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
  const archivedBranch = `feature/${issueId.toLowerCase()}-${archivedStem}`;

  if (existsSync(oldWorktree)) {
    await deps.runGitCommand(`git worktree move ${JSON.stringify(oldWorktree)} ${JSON.stringify(archivedWorktree)}`, workspacePath);
  }
  await deps.runGitCommand(`git branch -m ${JSON.stringify(oldBranch)} ${JSON.stringify(archivedBranch)}`, workspacePath);

  const attempt: SwarmSupersededAttempt = {
    slotIndex: slot.slotIndex,
    itemId: slot.itemId,
    agentId: slot.agentId,
    branch: oldBranch,
    archivedBranch,
    ...(existsSync(archivedWorktree) ? { archivedWorktree } : {}),
    reason: slot.reason ?? 'failed swarm slot',
    supersededAt: now.toISOString(),
  };
  await writeSwarmSupersededAttempt(workspacePath, normalized, attempt);
  // PAN-2372 WI-4 / FR-6: this slot is being superseded/requeued — clear its
  // durable completion marker so a fresh attempt on the same slotIndex is not
  // falsely observed as already-completed by classifyInFlightSlots.
  await clearSwarmSlotCompletion(workspacePath, normalized, slot.slotIndex);
  await deps.clearSlotAssignment(workspacePath, normalized, slot.slotIndex, slot.itemId);
  return attempt;
}

export async function requeueFailedSwarmSlots(
  issueId: string,
  workspacePath: string,
  classified: ClassifiedSlot[],
  doc: XBriefDocument,
  reconciled: SlotReconcileResult,
  deps: FailedSlotRequeueDeps,
  blockedSlotIndexes: Set<number> = new Set(),
): Promise<{ doc: XBriefDocument; actions: string[] }> {
  let nextDoc = doc;
  const actions: string[] = [];
  for (const slot of classified.filter(candidate => candidate.lifecycle === 'failed')) {
    if (blockedSlotIndexes.has(slot.slotIndex)) {
      actions.push(`[swarm] skipped requeue slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: failed-merge block — awaiting operator recovery`);
      continue;
    }
    // PAN-3917: the redrive gate and the recovery-trip ladder both existed to
    // reconcile stored attempt counters. A failed slot is archived and its item
    // requeued; the archived branch is the forensic record.
    const attempt = await archiveFailedSwarmSlot(issueId, workspacePath, slot, deps);
    await deps.applyTaskOperationToPlanFile(issueId, {
      type: 'unblock', itemId: slot.itemId, writerId: 'deacon-swarm', reason: `Redispatch after ${slot.reason ?? 'slot failure'}`,
    }, workspacePath);
    reconciled.inFlight = reconciled.inFlight.filter(candidate => candidate.itemId !== slot.itemId);
    reconciled.superseded = [...(reconciled.superseded ?? []), attempt];
    nextDoc = { ...nextDoc, plan: { ...nextDoc.plan, items: nextDoc.plan.items.map(item => item.id === slot.itemId ? { ...item, status: 'pending' as const } : item) } };
    actions.push(`[swarm] archived failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}`);
  }
  return { doc: nextDoc, actions };
}

export function applySupersededSlotHighWater(
  occupied: Set<number>,
  reconciled: SlotReconcileResult,
  configuredMax: number,
): number {
  const highWater = Math.max(0, ...(reconciled.superseded ?? []).map(attempt => attempt.slotIndex));
  if (highWater > 0) for (let index = 1; index <= highWater; index++) occupied.add(index);
  return Math.max(configuredMax, highWater + 1);
}
