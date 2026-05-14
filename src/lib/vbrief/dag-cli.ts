/**
 * CLI-only synchronous vBRIEF plan mutation helpers.
 *
 * These use sync FS calls and are NOT imported by dashboard server code.
 * Dashboard routes use the async variants in dag.ts.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import type { VBriefDocument, VBriefItem, VBriefItemStatus } from './types.js';
import {
  activePlanWriters,
  applyTaskOperation,
  getDispatchableItems,
  isTaskCommand,
  lockOwnerPath,
  lockPathForPlan,
  setPipelineMirror,
  validatePlanIssue,
  workspacePlanPath,
  type NestedPlanPipelineMirror,
  type PersistedTaskOperation,
  type TaskCommand,
  type TaskCommandOptions,
  type TaskOperationResult,
} from './dag.js';
import { readWorkspacePlan } from './io.js';
import { readWorkspaceContinue, writeWorkspaceContinue } from '../pan-dir/continue.js';

function assertSingleWriter(planPath: string, writerId: string): void {
  const owner = activePlanWriters.get(planPath);
  if (owner && owner !== writerId) {
    throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${owner} already owns the worktree`);
  }
  const lockPath = lockPathForPlan(planPath);
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    try {
      writeFileSync(
        lockOwnerPath(planPath),
        JSON.stringify({ writerId, pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2),
        'utf-8',
      );
    } catch (writeErr) {
      try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* best effort */ }
      throw writeErr;
    }
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
    let lockOwner = 'unknown writer';
    try {
      const ownerData = JSON.parse(readFileSync(lockOwnerPath(planPath), 'utf-8')) as {
        writerId?: string; pid?: number; acquiredAt?: string;
      };
      lockOwner = `${ownerData.writerId ?? 'unknown writer'} pid=${ownerData.pid ?? 'unknown'} acquiredAt=${ownerData.acquiredAt ?? 'unknown'}`;
    } catch { /* ignore malformed owner file */ }
    throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${lockOwner} already owns the worktree`);
  }
  activePlanWriters.set(planPath, writerId);
}

function releasePlanWriter(planPath: string, writerId: string): void {
  if (activePlanWriters.get(planPath) === writerId) activePlanWriters.delete(planPath);
  rmSync(lockPathForPlan(planPath), { recursive: true, force: true });
}

function readPlanFile(planPath: string): VBriefDocument {
  return JSON.parse(readFileSync(planPath, 'utf-8')) as VBriefDocument;
}

function writePlanFileAtomic(planPath: string, doc: VBriefDocument): void {
  mkdirSync(dirname(planPath), { recursive: true });
  const tmp = `${planPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, planPath);
}

/** Mirror a task operation's status changes into the workspace continue file so canonical readers see them. */
function mirrorTaskOperationToContinueFile(
  workspacePath: string,
  itemId: string,
  status: VBriefItemStatus,
  subItemIds?: string[],
): void {
  const continueState = readWorkspaceContinue(workspacePath) ?? {
    version: '1' as const,
    issueId: '',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };
  const overrides = { ...continueState.statusOverrides };
  overrides[itemId] = status;

  // Derive affected subItems from the plan for canonical overlay
  const doc = readWorkspacePlan(workspacePath);
  if (doc) {
    const item = doc.plan.items.find(i => i.id === itemId);
    if (item?.subItems) {
      const allSubIds = item.subItems.map(s => s.id);
      const affectedSubIds = subItemIds?.length
        ? subItemIds.filter(id => allSubIds.includes(id))
        : (status === 'completed' ? allSubIds : []);
      for (const subId of affectedSubIds) {
        overrides[`${itemId}.${subId}`] = status;
      }
    }
  }

  continueState.statusOverrides = overrides;
  writeWorkspaceContinue(workspacePath, continueState);
}

/** Persist a task operation to workspace .pan/spec.vbrief.json with CAS + single-writer guard. */
export function applyTaskOperationToPlanFile(planPath: string, operation: PersistedTaskOperation): TaskOperationResult {
  if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found: ${planPath}`);
  assertSingleWriter(planPath, operation.writerId);
  try {
    const current = readPlanFile(planPath);
    const result = applyTaskOperation(current, operation);
    writePlanFileAtomic(planPath, result.doc);
    // PAN-977: also update canonical continue-state overlay
    const workspacePath = dirname(dirname(planPath));
    mirrorTaskOperationToContinueFile(workspacePath, operation.itemId, result.item.status, operation.subItemIds);
    return result;
  } finally {
    releasePlanWriter(planPath, operation.writerId);
  }
}

export function writePipelineMirrorToPlanFile(planPath: string, mirror: NestedPlanPipelineMirror, writerId = `pipeline-${process.pid}`): VBriefDocument | null {
  if (!existsSync(planPath)) return null;
  assertSingleWriter(planPath, writerId);
  try {
    const doc = readPlanFile(planPath);
    setPipelineMirror(doc, mirror as unknown as import('./dag.js').PlanPipelineMirror);
    const now = new Date().toISOString();
    doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
    doc.plan.updated = now;
    doc.vBRIEFInfo.updated = now;
    writePlanFileAtomic(planPath, doc);
    return doc;
  } finally {
    releasePlanWriter(planPath, writerId);
  }
}

/** CLI/API-facing vBRIEF task operations for next/show/claim/done/block/unblock/cancel. */
export function runTaskCommand(command: TaskCommand, options: TaskCommandOptions): VBriefItem | VBriefItem[] | TaskOperationResult {
  if (!isTaskCommand(String(command))) {
    throw new Error(`Unsupported vBRIEF task command: ${String(command)}`);
  }

  // PAN-977: next/show read the canonical merged view (main spec + continue statusOverrides)
  if (command === 'next' || command === 'show') {
    let doc = readWorkspacePlan(options.workspacePath);
    if (!doc) {
      // Fallback: workspace-local spec for pre-canonical or test environments
      const planPath = workspacePlanPath(options.workspacePath);
      if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found for workspace: ${options.workspacePath}`);
      doc = readPlanFile(planPath);
    }
    validatePlanIssue(doc, options.issueId);
    if (command === 'next') return getDispatchableItems(doc, options.mergedItemIds ?? new Set());
    if (!options.itemId) throw new Error('show requires itemId');
    const item = doc.plan.items.find(i => i.id === options.itemId);
    if (!item) throw new Error(`Plan item not found: ${options.itemId}`);
    return item;
  }

  // Mutations write to the workspace-local spec for sequence/metadata, AND to the
  // continue file statusOverrides so canonical readers see the change.
  const planPath = workspacePlanPath(options.workspacePath);
  if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found: ${planPath}`);
  const doc = readPlanFile(planPath);
  validatePlanIssue(doc, options.issueId);
  if (!options.itemId) throw new Error(`${command} requires itemId`);
  return applyTaskOperationToPlanFile(planPath, {
    type: command,
    itemId: options.itemId,
    expectedSequence: options.expectedSequence,
    reason: options.reason,
    writerId: options.writerId ?? `pan-task-${process.pid}`,
  });
}
