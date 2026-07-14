/** Single task-mutation write door over the immutable vBRIEF specification. */
import { hostname } from 'node:os';
import { join } from 'node:path';

import type { ProjectConfig } from '../projects.js';
import type { TaskOperationType } from '../vbrief/dag.js';
import { applyStatusOverrides, findPlanSync, readPlanSync } from '../vbrief/io.js';
import { subItemsOf, type VBriefItemStatus } from '../vbrief/types.js';
import {
  type PanIssueRecord,
  type TaskClaim,
  type TaskClaimHistoryEntry,
} from './record.js';
import { updateIssueRecord } from './record-update.js';

export interface TaskStatusChange {
  type: TaskOperationType;
  itemId: string;
  subItemIds?: string[];
  reason?: string;
  expectedSequence?: number;
  force?: boolean;
  writerId?: string;
}

export interface TaskStatusChangeResult {
  issueId: string;
  itemId: string;
  status: VBriefItemStatus;
  sequence: number;
  claim?: TaskClaim;
  idempotent?: boolean;
}

export class TaskStatusChangeError extends Error {
  constructor(
    message: string,
    public readonly details: {
      issueId: string;
      itemId: string;
      operation: TaskOperationType;
      currentStatus?: string;
      owner?: string;
      currentSequence?: number;
    },
  ) {
    super(message);
    this.name = 'TaskStatusChangeError';
  }
}

const TERMINAL = new Set<VBriefItemStatus>(['completed', 'cancelled']);

function statusFor(type: TaskOperationType): VBriefItemStatus {
  if (type === 'claim') return 'running';
  if (type === 'done') return 'completed';
  if (type === 'block') return 'blocked';
  if (type === 'unblock') return 'pending';
  return 'cancelled';
}

function allowedFrom(type: TaskOperationType, status: VBriefItemStatus): boolean {
  if (type === 'claim') return status === 'pending';
  if (type === 'done') return status === 'running';
  if (type === 'block') return status === 'pending' || status === 'running';
  if (type === 'unblock') return status === 'blocked';
  return status === 'pending' || status === 'running' || status === 'blocked';
}

function taskError(
  issueId: string,
  itemId: string,
  operation: TaskOperationType,
  currentStatus: string,
  owner?: string,
  extra?: string,
): TaskStatusChangeError {
  const ownerText = owner ? ` The current claim owner is ${owner}.` : '';
  const recovery = `Run \`pan task show ${issueId} ${itemId}\` to inspect the current task state before retrying.`;
  return new TaskStatusChangeError(
    `Task ${itemId} on ${issueId} is ${currentStatus}, so ${operation} is not allowed.${ownerText}${extra ? ` ${extra}` : ''} ${recovery}`,
    { issueId, itemId, operation, currentStatus, owner },
  );
}

function archiveClaim(
  record: PanIssueRecord,
  itemId: string,
  outcome: TaskClaimHistoryEntry['outcome'],
  reason: string | undefined,
  forced: boolean,
  now: string,
): void {
  const claim = record.tasks?.claims[itemId];
  if (!claim || !record.tasks) return;
  const entry: TaskClaimHistoryEntry = { ...claim, itemId, outcome, reason, forced: forced || undefined, releasedAt: now };
  record.tasks.claimHistory = [...(record.tasks.claimHistory ?? []), entry].slice(-50);
  delete record.tasks.claims[itemId];
}

export async function applyTaskStatusChange(
  project: ProjectConfig,
  issueId: string,
  operation: TaskStatusChange,
): Promise<TaskStatusChangeResult> {
  const normalizedIssueId = issueId.toUpperCase();
  const writerId = operation.writerId ?? process.env.OVERDECK_AGENT_ID ?? `cli-${process.pid}@${hostname()}`;
  let result: TaskStatusChangeResult | undefined;

  await updateIssueRecord(project, normalizedIssueId, (record) => {
    const workspacePath = join(project.path, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`);
    const planPath = findPlanSync(workspacePath);
    if (!planPath) throw new Error(`The vBRIEF for ${normalizedIssueId} is missing or unreadable. Return the issue to planning before changing task state.`);
    const doc = applyStatusOverrides(readPlanSync(planPath), record.statusOverrides ?? {});
    const item = doc.plan.items.find(({ id }) => id === operation.itemId);
    if (!item) throw new Error(`Task ${operation.itemId} does not exist in the immutable vBRIEF for ${normalizedIssueId}. Return the issue to planning to change scope.`);

    const currentStatus = item.status;
    const currentSequence = record.tasks?.sequence ?? 0;
    const existingClaim = record.tasks?.claims[operation.itemId];
    if (operation.expectedSequence !== undefined && operation.expectedSequence !== currentSequence) {
      throw new TaskStatusChangeError(
        `Task sequence conflict for ${normalizedIssueId}: expected ${operation.expectedSequence}, but the current sequence is ${currentSequence}. Run \`pan task next ${normalizedIssueId}\` and retry with the new sequence.`,
        { issueId: normalizedIssueId, itemId: operation.itemId, operation: operation.type, currentStatus, currentSequence },
      );
    }
    if (TERMINAL.has(currentStatus)) throw taskError(normalizedIssueId, operation.itemId, operation.type, currentStatus, existingClaim?.writerId);
    if (operation.force && !operation.reason) {
      throw taskError(normalizedIssueId, operation.itemId, operation.type, currentStatus, existingClaim?.writerId, 'A forced transition requires --reason.');
    }
    if ((operation.type === 'block' || operation.type === 'cancel') && !operation.reason) {
      throw taskError(normalizedIssueId, operation.itemId, operation.type, currentStatus, existingClaim?.writerId, 'This transition requires --reason.');
    }
    if (operation.type === 'claim' && currentStatus === 'running' && existingClaim?.writerId === writerId) {
      result = { issueId: normalizedIssueId, itemId: operation.itemId, status: 'running', sequence: currentSequence, claim: existingClaim, idempotent: true };
      return record;
    }
    const ownerRestricted = (operation.type === 'done' || operation.type === 'block' || operation.type === 'cancel') && currentStatus === 'running';
    if (!operation.force && ownerRestricted && existingClaim?.writerId !== writerId) {
      throw taskError(normalizedIssueId, operation.itemId, operation.type, currentStatus, existingClaim?.writerId ?? 'missing claim owner');
    }
    if (!operation.force && !allowedFrom(operation.type, currentStatus)) {
      throw taskError(normalizedIssueId, operation.itemId, operation.type, currentStatus, existingClaim?.writerId);
    }

    const now = new Date().toISOString();
    const nextStatus = statusFor(operation.type);
    record.tasks ??= { sequence: 0, claims: {} };
    record.statusOverrides = { ...(record.statusOverrides ?? {}), [operation.itemId]: nextStatus };
    const subIds = operation.subItemIds?.length
      ? new Set(operation.subItemIds)
      : new Set(operation.type === 'done' ? subItemsOf(item).map(({ id }) => id) : []);
    for (const subId of subIds) record.statusOverrides[`${operation.itemId}.${subId}`] = nextStatus;

    if (operation.type === 'claim') {
      record.tasks.claims[operation.itemId] = {
        writerId,
        agentId: process.env.OVERDECK_AGENT_ID ?? null,
        pid: process.pid,
        host: hostname(),
        claimedAt: now,
      };
    } else if (existingClaim) {
      archiveClaim(record, operation.itemId, nextStatus === 'completed' ? 'completed' : nextStatus === 'blocked' ? 'blocked' : 'cancelled', operation.reason, operation.force ?? false, now);
    }
    if (operation.reason) {
      record.tasks.statusReasons = {
        ...(record.tasks.statusReasons ?? {}),
        [operation.itemId]: { reason: operation.reason, updatedAt: now, forced: operation.force || undefined },
      };
    }
    record.tasks.sequence = currentSequence + 1;
    result = {
      issueId: normalizedIssueId,
      itemId: operation.itemId,
      status: nextStatus,
      sequence: record.tasks.sequence,
      claim: record.tasks.claims[operation.itemId],
    };
    return record;
  }, { writerId });

  if (!result) throw new Error(`Task mutation for ${normalizedIssueId}/${operation.itemId} produced no result.`);
  return result;
}
