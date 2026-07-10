import { existsSync } from 'node:fs';
import type { ReconciledSlotItem, SlotReconcileResult } from '../agents/slot-reconcile.js';
import {
  readIssueRecordForWorkspaceSync,
  writeIssueRecordForWorkspaceSync,
  type PanIssueRecord,
  type PanIssueSwarmSupersededAttempt,
} from '../pan-dir/record.js';
import { createMinimalIssueRecord } from './deacon-swarm-record.js';
import type { ClassifiedSwarmSlot } from './deacon-swarm.js';
import type { PersistedTaskOperation } from '../vbrief/dag.js';
import type { VBriefDocument } from '../vbrief/types.js';

/** Patrol GC never removes forensic attempts; configured issue close-out owns teardown. */
export const SWARM_SUPERSEDED_RETENTION = 'issue-close-out' as const;

export interface FailedSlotArchiveDeps {
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => void;
}

export function nextSwarmSlotIndex(record: PanIssueRecord | undefined, reconciled: SlotReconcileResult): number {
  return Math.max(0,
    ...reconciled.branches.map(value => value.slotIndex),
    ...reconciled.agents.map(value => value.slotIndex),
    ...reconciled.inFlight.map(value => value.slotIndex),
    ...(record?.swarm?.slotAssignments ?? []).map(value => value.slotIndex),
    ...(record?.swarm?.supersededAttempts ?? []).map(value => value.slotIndex),
  ) + 1;
}

export async function archiveFailedSwarmSlot(
  issueId: string,
  workspacePath: string,
  slot: ReconciledSlotItem & { reason?: string },
  deps: FailedSlotArchiveDeps,
  now = new Date(),
): Promise<PanIssueSwarmSupersededAttempt> {
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

  const attempt: PanIssueSwarmSupersededAttempt = {
    slotIndex: slot.slotIndex,
    itemId: slot.itemId,
    agentId: slot.agentId,
    branch: oldBranch,
    archivedBranch,
    ...(existsSync(archivedWorktree) ? { archivedWorktree } : {}),
    reason: slot.reason ?? 'failed swarm slot',
    supersededAt: now.toISOString(),
  };
  const existing = readIssueRecordForWorkspaceSync(workspacePath, normalized) ?? createMinimalIssueRecord(normalized);
  writeIssueRecordForWorkspaceSync(workspacePath, normalized, {
    ...existing,
    swarm: {
      ...(existing.swarm ?? {}),
      supersededAttempts: [...(existing.swarm?.supersededAttempts ?? []), attempt],
    },
  });
  deps.clearSlotAssignment(workspacePath, normalized, slot.slotIndex, slot.itemId);
  return attempt;
}

export async function requeueFailedSwarmSlots(
  issueId: string,
  workspacePath: string,
  classified: ClassifiedSwarmSlot[],
  doc: VBriefDocument,
  reconciled: SlotReconcileResult,
  deps: FailedSlotArchiveDeps & { applyTaskOperationToPlanFile: (path: string, operation: PersistedTaskOperation, workspace?: string) => Promise<unknown> },
): Promise<{ doc: VBriefDocument; actions: string[] }> {
  let nextDoc = doc;
  const actions: string[] = [];
  for (const slot of classified.filter(candidate => candidate.lifecycle === 'failed')) {
    const attempt = await archiveFailedSwarmSlot(issueId, workspacePath, slot, deps);
    await deps.applyTaskOperationToPlanFile(`${workspacePath}/.pan/spec.vbrief.json`, {
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
