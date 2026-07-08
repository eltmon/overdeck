import { join } from 'node:path';
import { analyzeSwarmReadiness } from '../vbrief/swarm-readiness.js';
import type { VBriefDocument } from '../vbrief/types.js';
import { setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import type { PersistedTaskOperation } from '../vbrief/dag.js';
import type { SlotReconcileResult } from '../agents/slot-reconcile.js';
import type { SpawnRunOptions } from '../agents/spawn-prep.js';
import type { SwarmReadinessVerdict } from '../vbrief/swarm-readiness.js';

const SWARM_SLOT_FAILURE_THRESHOLD = 3;
const slotFailureCounts = new Map<string, number>();

export interface FailedSlotRecoveryBlock {
  issueId: string;
  itemId: string;
  slotIndex: number;
  branch?: string;
  note: string;
}

export interface ClassifiedSwarmSlotForRecovery {
  itemId: string;
  slotIndex: number;
  status: 'merged' | 'in_flight' | 'pending';
  branch?: string;
  agentId?: string;
  lifecycle: 'running' | 'ready-to-merge' | 'failed' | 'stalled' | 'awaiting-completion-signal';
  reason?: string;
}

export interface SwarmFailedSlotRecoveryDeps {
  applyTaskOperationToPlanFile: (planPath: string, operation: PersistedTaskOperation, workspacePath?: string) => Promise<unknown>;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => void;
  recordSlotAssignment: (workspacePath: string, issueId: string, assignment: { slotIndex: number; itemId: string; agentId?: string; branch?: string }) => void;
  registeredSlotCapacityAvailable: (issueId: string, selectedCount: number) => boolean;
  tryReserveSwarmSlot: () => boolean;
  releaseSwarmSlot: () => void;
  spawnRun: (issueId: string, role: 'work', options: SpawnRunOptions) => Promise<unknown>;
  shouldDispatch?: (issueId: string) => boolean;
  getMaxSlotIndex?: () => number;
  listSlotAssignments?: (issueId: string, workspacePath: string) => Array<{ slotIndex: number }>;
  listSessionNames?: () => Promise<readonly string[]>;
  slotWorktreeExists?: (slotWorkspacePath: string) => boolean;
  setReviewStatus?: (issueId: string, update: Partial<ReviewStatus>) => ReviewStatus;
  dispatchNextWave: (issueId: string, workspacePath: string, doc: VBriefDocument, reconciled: SlotReconcileResult, readiness: SwarmReadinessVerdict, deps: SwarmFailedSlotRecoveryDeps) => Promise<string[]>;
  getFailedMergeBlock: (issueId: string, workspacePath?: string) => FailedSlotRecoveryBlock | undefined;
  recordFailedMergeBlock: (block: FailedSlotRecoveryBlock, workspacePath?: string) => void;
}

export async function recoverFailedSlots(
  issueId: string,
  workspacePath: string,
  doc: VBriefDocument,
  slots: ClassifiedSwarmSlotForRecovery[],
  deps: SwarmFailedSlotRecoveryDeps,
): Promise<string[]> {
  const normalizedIssueId = issueId.toUpperCase();
  if (deps.getFailedMergeBlock(normalizedIssueId, workspacePath)) return [];

  const failed = slots.find(slot => slot.lifecycle === 'failed');
  if (!failed) return [];

  const failureKey = slotFailureKey(normalizedIssueId, workspacePath, failed.itemId);
  const failureCount = (slotFailureCounts.get(failureKey) ?? 0) + 1;
  slotFailureCounts.set(failureKey, failureCount);
  const failureReason = failed.reason ?? 'failed';

  if (failureCount >= SWARM_SLOT_FAILURE_THRESHOLD) {
    const note = `Slot ${failed.slotIndex} failed ${failureCount} time(s): ${failureReason}`;
    deps.recordFailedMergeBlock({
      issueId: normalizedIssueId,
      itemId: failed.itemId,
      slotIndex: failed.slotIndex,
      branch: failed.branch,
      note,
    }, workspacePath);
    (deps.setReviewStatus ?? setReviewStatusSync)(normalizedIssueId, {
      stuck: true,
      stuckReason: 'swarm_slot_failure',
      stuckDetails: JSON.stringify({
        itemId: failed.itemId,
        slotIndex: failed.slotIndex,
        reason: failureReason,
        attempts: failureCount,
      }),
    });
    return [
      `[swarm] failed slot ${failed.slotIndex} (item ${failed.itemId}) for ${normalizedIssueId}: ${failureReason}; retry limit reached — needs operator attention`,
    ];
  }

  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');
  await deps.applyTaskOperationToPlanFile(planPath, {
    type: 'unblock',
    itemId: failed.itemId,
    writerId: 'deacon-swarm',
    reason: `Retrying failed swarm slot after ${failureReason}`,
  }, workspacePath);
  deps.clearSlotAssignment(workspacePath, normalizedIssueId, failed.slotIndex, failed.itemId);

  const retryDoc = {
    ...doc,
    plan: {
      ...doc.plan,
      items: doc.plan.items.map(item =>
        item.id === failed.itemId ? { ...item, status: 'pending' as const } : item
      ),
    },
  };
  const remainingInFlight = slots
    .filter(slot => slot.lifecycle !== 'failed')
    .map(slot => ({
      itemId: slot.itemId,
      slotIndex: slot.slotIndex,
      status: slot.status,
      branch: slot.branch,
      agentId: slot.agentId,
    }));

  return [
    `[swarm] retrying failed slot ${failed.slotIndex} (item ${failed.itemId}) for ${normalizedIssueId}: ${failureReason}`,
    ...await deps.dispatchNextWave(normalizedIssueId, workspacePath, retryDoc, {
      issueId: normalizedIssueId,
      merged: [],
      inFlight: remainingInFlight,
      pending: [],
      branches: failed.branch ? [{ slotIndex: failed.slotIndex, branch: failed.branch, merged: false }] : [],
      agents: [],
    }, analyzeSwarmReadiness(retryDoc), deps),
  ];
}

export function resetSwarmSlotFailureRecoveryForTests(): void {
  slotFailureCounts.clear();
}

export function clearSlotFailureCount(issueId: string, workspacePath: string, itemId: string): void {
  slotFailureCounts.delete(slotFailureKey(issueId.toUpperCase(), workspacePath, itemId));
}

export function recordStalledSlotRecovery(
  issueId: string,
  slots: ClassifiedSwarmSlotForRecovery[],
  deps: Pick<SwarmFailedSlotRecoveryDeps, 'getFailedMergeBlock' | 'recordFailedMergeBlock'>,
  workspacePath?: string,
): string[] {
  const actions: string[] = [];
  const normalizedIssueId = issueId.toUpperCase();
  if (deps.getFailedMergeBlock(normalizedIssueId, workspacePath)) return actions;

  const stalled = slots.find(slot => slot.lifecycle === 'stalled');
  if (!stalled) return actions;

  deps.recordFailedMergeBlock({
    issueId: normalizedIssueId,
    itemId: stalled.itemId,
    slotIndex: stalled.slotIndex,
    branch: stalled.branch,
    note: `Slot ${stalled.slotIndex} stalled with no branch commit or pane output progress`,
  }, workspacePath);
  actions.push(`[swarm] stalled slot ${stalled.slotIndex} (item ${stalled.itemId}) for ${normalizedIssueId}: recovery required`);
  return actions;
}

function slotFailureKey(issueId: string, workspacePath: string, itemId: string): string {
  return `${issueId}:${workspacePath}:${itemId}`;
}
