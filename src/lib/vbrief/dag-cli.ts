/**
 * CLI-only synchronous vBRIEF plan mutation helpers.
 *
 * These use sync FS calls and are NOT imported by dashboard server code.
 * Dashboard routes use the async variants in dag.ts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join as pathJoin } from 'path';

import type { VBriefDocument, VBriefItem, VBriefItemStatus } from './types.js';
import {
  activePlanWriters,
  applyTaskOperation,
  getDispatchableItems,
  isPidDead,
  isTaskCommand,
  lockOwnerPath,
  lockPathForPlan,
  setPipelineMirror,
  validatePlanIssue,
  type NestedPlanPipelineMirror,
  type PersistedTaskOperation,
  type TaskCommand,
  type TaskCommandOptions,
  type TaskOperationResult,
} from './dag.js';
import { findPlan, readWorkspacePlan } from './io.js';
import { readWorkspaceContinue, writeWorkspaceContinue } from '../pan-dir/continue.js';

function assertSingleWriter(planPath: string, writerId: string): void {
  const owner = activePlanWriters.get(planPath);
  if (owner && owner !== writerId) {
    throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${owner} already owns the worktree`);
  }
  const lockPath = lockPathForPlan(planPath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      activePlanWriters.set(planPath, writerId);
      return;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      let lockOwner = 'unknown writer';
      let ownerPid: number | undefined;
      try {
        const ownerData = JSON.parse(readFileSync(lockOwnerPath(planPath), 'utf-8')) as {
          writerId?: string; pid?: number; acquiredAt?: string;
        };
        ownerPid = ownerData.pid;
        lockOwner = `${ownerData.writerId ?? 'unknown writer'} pid=${ownerData.pid ?? 'unknown'} acquiredAt=${ownerData.acquiredAt ?? 'unknown'}`;
      } catch { /* ignore malformed owner file */ }
      // Reclaim orphan locks left behind by crashed writers (dead PID).
      if (attempt === 0 && isPidDead(ownerPid)) {
        console.warn(`[vbrief] Reclaiming orphan writer lock for ${planPath} (dead ${lockOwner})`);
        removeStaleLockSync(planPath);
        continue;
      }
      throw new Error(`vBRIEF plan writer conflict for ${planPath}: ${lockOwner} already owns the worktree`);
    }
  }
}

function removeStaleLockSync(planPath: string): void {
  rmSync(lockPathForPlan(planPath), { recursive: true, force: true });
  try {
    const dir = dirname(planPath);
    const base = planPath.slice(dir.length + 1);
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(`${base}.`) && entry.endsWith('.tmp')) {
        try { rmSync(pathJoin(dir, entry), { force: true }); } catch { /* best effort */ }
      }
    }
  } catch { /* best effort */ }
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
export function applyTaskOperationToPlanFile(planPath: string, operation: PersistedTaskOperation, workspacePath?: string): TaskOperationResult {
  if (!existsSync(planPath)) throw new Error(`vBRIEF plan not found: ${planPath}`);
  assertSingleWriter(planPath, operation.writerId);
  try {
    const current = readPlanFile(planPath);
    const result = applyTaskOperation(current, operation);
    writePlanFileAtomic(planPath, result.doc);
    // PAN-977: also update canonical continue-state overlay. When the planPath
    // is a canonical spec on main (PAN-1124), dirname(dirname(planPath)) yields
    // the project root, not the workspace root. Callers must pass the correct
    // workspacePath so the mirror lands in <workspace>/.pan/continue.json.
    const wsPath = workspacePath ?? dirname(dirname(planPath));
    mirrorTaskOperationToContinueFile(wsPath, operation.itemId, result.item.status, operation.subItemIds);
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
    const doc = readWorkspacePlan(options.workspacePath);
    if (!doc) throw new Error(`vBRIEF plan not found for workspace: ${options.workspacePath}`);
    validatePlanIssue(doc, options.issueId);
    if (command === 'next') return getDispatchableItems(doc, options.mergedItemIds ?? new Set());
    if (!options.itemId) throw new Error('show requires itemId');
    const item = doc.plan.items.find(i => i.id === options.itemId);
    if (!item) throw new Error(`Plan item not found: ${options.itemId}`);
    return item;
  }

  // Mutations write to the canonical spec on main (PAN-1124) AND to the continue
  // file statusOverrides so canonical readers see the change.
  const planPath = findPlan(options.workspacePath);
  if (!planPath) throw new Error(`vBRIEF plan not found for workspace: ${options.workspacePath}`);
  const doc = readPlanFile(planPath);
  validatePlanIssue(doc, options.issueId);
  if (!options.itemId) throw new Error(`${command} requires itemId`);
  return applyTaskOperationToPlanFile(planPath, {
    type: command,
    itemId: options.itemId,
    expectedSequence: options.expectedSequence,
    reason: options.reason,
    writerId: options.writerId ?? `pan-task-${process.pid}`,
  }, options.workspacePath);
}
