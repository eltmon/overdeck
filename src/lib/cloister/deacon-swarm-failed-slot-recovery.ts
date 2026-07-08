import { join } from 'node:path';
import type { ReconciledSlotItem, SlotReconcileResult } from '../agents/slot-reconcile.js';
import type { PersistedTaskOperation } from '../vbrief/dag.js';
import type { SwarmReadinessVerdict } from '../vbrief/swarm-readiness.js';
import type { VBriefDocument } from '../vbrief/types.js';

const FAILED_SLOT_RECOVERY_RETRY_LIMIT = 3;
const FAILED_SLOT_RECOVERY_BACKOFF_MS = 5 * 60 * 1000;

const failedSlotRecoveryAttempts = new Map<string, { count: number; nextRetryAt: number }>();

type FailedSlotRecoveryDeps = {
  applyTaskOperationToPlanFile: (planPath: string, operation: PersistedTaskOperation, workspacePath?: string) => Promise<unknown>;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => void;
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  getSlotBranchAheadCount: (workspacePath: string, issueId: string, branch: string) => Promise<number>;
};

interface FailedMergeBlock {
  issueId: string;
  itemId: string;
  slotIndex: number;
  branch?: string;
  note: string;
}

interface ClassifiedSwarmSlot extends ReconciledSlotItem {
  lifecycle: 'running' | 'ready-to-merge' | 'failed' | 'stalled' | 'awaiting-completion-signal';
  reason?: 'missing-agent' | 'vanished-session' | 'pane-exit-nonzero' | 'pane-exit-unknown' | 'no-progress-timeout';
}

interface FailedSlotRecoveryBlockDeps {
  getFailedMergeBlock: (issueId: string, workspacePath?: string) => FailedMergeBlock | undefined;
  recordFailedMergeBlock: (block: FailedMergeBlock, workspacePath?: string) => void;
}

export async function recoverFailedWorkSlots(
  issueId: string,
  workspacePath: string,
  doc: VBriefDocument,
  reconciled: SlotReconcileResult,
  readiness: SwarmReadinessVerdict,
  slots: ClassifiedSwarmSlot[],
  deps: FailedSlotRecoveryDeps,
  blockDeps: FailedSlotRecoveryBlockDeps,
  now = Date.now(),
): Promise<{ actions: string[]; reconciled?: SlotReconcileResult; doc?: VBriefDocument }> {
  const actions: string[] = [];
  let nextReconciled: SlotReconcileResult | undefined;
  let nextDoc: VBriefDocument | undefined;
  const normalizedIssueId = issueId.toUpperCase();
  if (blockDeps.getFailedMergeBlock(normalizedIssueId, workspacePath)) return { actions };

  const itemsById = new Map(doc.plan.items.map(item => [item.id, item]));
  const slotEligibleIds = new Set(readiness.items.filter(item => item.slotEligible).map(item => item.id));
  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

  for (const slot of slots) {
    if (slot.lifecycle !== 'failed') continue;
    const item = itemsById.get(slot.itemId);
    if (!item || !slotEligibleIds.has(slot.itemId)) {
      actions.push(`[swarm] failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: item is no longer dispatchable — needs operator attention`);
      continue;
    }

    const recoveryKey = `${normalizedIssueId}:${slot.itemId}`;
    const attempt = failedSlotRecoveryAttempts.get(recoveryKey);
    if (attempt && attempt.nextRetryAt > now) {
      actions.push(`[swarm] deferred failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: retry backoff active`);
      continue;
    }

    const count = (attempt?.count ?? 0) + 1;
    if (count > FAILED_SLOT_RECOVERY_RETRY_LIMIT) {
      blockDeps.recordFailedMergeBlock({
        issueId: normalizedIssueId,
        itemId: slot.itemId,
        slotIndex: slot.slotIndex,
        branch: slot.branch,
        note: `Slot ${slot.slotIndex} failed repeatedly (${slot.reason ?? 'unknown failure'}); automatic redispatch exhausted`,
      }, workspacePath);
      actions.push(`[swarm] failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: retry cap exhausted — needs operator attention`);
      continue;
    }

    const branch = slot.branch ?? `feature/${normalizedIssueId.toLowerCase()}-slot-${slot.slotIndex}`;
    const aheadCount = await deps.getSlotBranchAheadCount(workspacePath, normalizedIssueId, branch).catch(() => 0);
    if (aheadCount > 0) {
      blockDeps.recordFailedMergeBlock({
        issueId: normalizedIssueId,
        itemId: slot.itemId,
        slotIndex: slot.slotIndex,
        branch,
        note: `Dead slot branch ${branch} has ${aheadCount} unmerged commit(s); operator recovery required before redispatch`,
      }, workspacePath);
      actions.push(`[swarm] failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: dead branch ${branch} has ${aheadCount} unmerged commit(s) — needs operator attention`);
      continue;
    }

    await deps.applyTaskOperationToPlanFile(planPath, {
      type: 'unblock',
      itemId: slot.itemId,
      writerId: 'deacon-swarm',
      reason: `Retrying failed swarm slot after ${slot.reason ?? 'slot failure'}`,
    }, workspacePath);
    deps.clearSlotAssignment(workspacePath, normalizedIssueId, slot.slotIndex, slot.itemId);

    const slotWorkspace = `${workspacePath}-slot-${slot.slotIndex}`;
    await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`, workspacePath)
      .catch(error => actions.push(`[swarm] failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: worktree cleanup deferred: ${error instanceof Error ? error.message : String(error)}`));
    await deps.runGitCommand(`git branch -D ${JSON.stringify(branch)}`, workspacePath)
      .catch(error => actions.push(`[swarm] failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: branch cleanup deferred: ${error instanceof Error ? error.message : String(error)}`));

    failedSlotRecoveryAttempts.set(recoveryKey, {
      count,
      nextRetryAt: now + FAILED_SLOT_RECOVERY_BACKOFF_MS,
    });
    actions.push(`[swarm] redispatching failed slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: ${slot.reason ?? 'slot failure'}`);

    const source = nextReconciled ?? reconciled;
    nextReconciled = {
      ...source,
      inFlight: source.inFlight.filter(entry => !(entry.slotIndex === slot.slotIndex && entry.itemId === slot.itemId)),
      branches: source.branches.filter(entry => entry.slotIndex !== slot.slotIndex),
      agents: source.agents.filter(entry => entry.slotIndex !== slot.slotIndex),
    };
    const sourceDoc = nextDoc ?? doc;
    nextDoc = {
      ...sourceDoc,
      plan: {
        ...sourceDoc.plan,
        items: sourceDoc.plan.items.map(planItem =>
          planItem.id === slot.itemId ? { ...planItem, status: 'pending' as const } : planItem
        ),
      },
    };
  }

  return { actions, reconciled: nextReconciled, doc: nextDoc };
}

export function recordStalledSlotRecovery(
  issueId: string,
  slots: ClassifiedSwarmSlot[],
  blockDeps: FailedSlotRecoveryBlockDeps,
  workspacePath?: string,
): string[] {
  const actions: string[] = [];
  const normalizedIssueId = issueId.toUpperCase();
  if (blockDeps.getFailedMergeBlock(normalizedIssueId, workspacePath)) return actions;

  const stalled = slots.find(slot => slot.lifecycle === 'stalled');
  if (!stalled) return actions;

  blockDeps.recordFailedMergeBlock({
    issueId: normalizedIssueId,
    itemId: stalled.itemId,
    slotIndex: stalled.slotIndex,
    branch: stalled.branch,
    note: `Slot ${stalled.slotIndex} stalled with no branch commit or pane output progress`,
  }, workspacePath);
  actions.push(`[swarm] stalled slot ${stalled.slotIndex} (item ${stalled.itemId}) for ${normalizedIssueId}: recovery required`);
  return actions;
}

export function resetFailedSlotRecoveryForTests(): void {
  failedSlotRecoveryAttempts.clear();
}
