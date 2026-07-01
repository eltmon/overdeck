import { Effect } from 'effect';
import { join } from 'path';
import { verifyAndMergeSlot, type SlotMergeResult } from '../agents/slot-merge.js';
import { reconcileSlotState, type ReconciledSlotItem, type SlotReconcileResult } from '../agents/slot-reconcile.js';
import { findSpecByIssue } from '../pan-dir/specs.js';
import { isPaneDead, listPaneValues, listSessionNames as listTmuxSessionNames } from '../tmux.js';
import { applyTaskOperationToPlanFile, type PersistedTaskOperation } from '../vbrief/dag.js';
import { analyzeSwarmReadiness } from '../vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../vbrief/types.js';
import { listFeatureWorkspaces, type FeatureWorkspace } from './deacon-workspaces.js';

export interface CoordinateSwarmSlotsOptions {
  issueId?: string;
}

export interface CoordinateSwarmSlotsDeps {
  listFeatureWorkspaces: () => FeatureWorkspace[];
  reconcileSlotState: (
    issueId: string,
    workspace: string,
    doc: VBriefDocument,
  ) => Promise<SlotReconcileResult>;
  listSessionNames: () => Promise<readonly string[]>;
  isPaneDead: (sessionName: string) => Promise<boolean>;
  getPaneExitStatus: (sessionName: string) => Promise<number | null>;
  verifyAndMergeSlot: (
    issue: { issueId: string; featureWorkspace: string },
    slotIndex: number,
    item: VBriefItem,
  ) => Promise<SlotMergeResult>;
  applyTaskOperationToPlanFile: (
    planPath: string,
    operation: PersistedTaskOperation,
    workspacePath?: string,
  ) => Promise<unknown>;
}

const defaultDeps: CoordinateSwarmSlotsDeps = {
  listFeatureWorkspaces: () => listFeatureWorkspaces({ includeSlotWorkspaces: false }),
  reconcileSlotState,
  listSessionNames: () => Effect.runPromise(listTmuxSessionNames()),
  isPaneDead: (sessionName) => Effect.runPromise(isPaneDead(sessionName)),
  getPaneExitStatus: async (sessionName) => {
    const values = await Effect.runPromise(listPaneValues(sessionName, '#{pane_dead_status}'));
    const raw = values[0]?.trim();
    if (!raw) return null;
    const status = Number(raw);
    return Number.isFinite(status) ? status : null;
  },
  verifyAndMergeSlot,
  applyTaskOperationToPlanFile: (planPath, operation, workspacePath) =>
    Effect.runPromise(applyTaskOperationToPlanFile(planPath, operation, workspacePath)),
};

export type SwarmSlotLifecycle = 'running' | 'ready-to-merge' | 'failed';

export interface ClassifiedSwarmSlot extends ReconciledSlotItem {
  lifecycle: SwarmSlotLifecycle;
  exitStatus?: number | null;
  reason?: 'missing-agent' | 'vanished-session' | 'pane-exit-nonzero' | 'pane-exit-unknown';
}

export async function coordinateSwarmSlots(
  opts: CoordinateSwarmSlotsOptions = {},
  deps: CoordinateSwarmSlotsDeps = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const filterIssueId = opts.issueId?.toUpperCase();

  for (const workspace of deps.listFeatureWorkspaces()) {
    const issueId = workspace.issueId.toUpperCase();
    if (filterIssueId && issueId !== filterIssueId) continue;

    try {
      const spec = await Effect.runPromise(findSpecByIssue(workspace.projectPath, issueId));
      if (!spec) continue;

      const readiness = analyzeSwarmReadiness(spec.document);
      const slotEligibleCount = readiness.items.filter(item => item.slotEligible).length;
      if (!readiness.swarmEligible || slotEligibleCount < 2) continue;

      actions.push(`[swarm] considered ${issueId}: swarm eligible`);

      const reconciled = await deps.reconcileSlotState(issueId, workspace.workspacePath, spec.document);
      const classified = await classifyInFlightSlots(reconciled.inFlight, deps);
      for (const slot of classified) {
        actions.push(`[swarm] ${issueId} slot ${slot.slotIndex} ${slot.lifecycle}`);
      }
      actions.push(...await mergeReadySlots(issueId, workspace.workspacePath, spec.document, classified, deps));
    } catch (err) {
      console.warn(`[deacon] Error coordinating swarm ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return actions;
}

export async function classifyInFlightSlots(
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'isPaneDead' | 'getPaneExitStatus'> = defaultDeps,
): Promise<ClassifiedSwarmSlot[]> {
  const sessionNames = new Set(await deps.listSessionNames());
  const classified: ClassifiedSwarmSlot[] = [];

  for (const slot of slots) {
    if (!slot.agentId) {
      classified.push({ ...slot, lifecycle: 'failed', reason: 'missing-agent' });
      continue;
    }

    if (!sessionNames.has(slot.agentId)) {
      classified.push({ ...slot, lifecycle: 'failed', reason: 'vanished-session' });
      continue;
    }

    const dead = await deps.isPaneDead(slot.agentId);
    if (!dead) {
      classified.push({ ...slot, lifecycle: 'running' });
      continue;
    }

    const exitStatus = await deps.getPaneExitStatus(slot.agentId);
    if (exitStatus === 0) {
      classified.push({ ...slot, lifecycle: 'ready-to-merge', exitStatus });
      continue;
    }

    classified.push({
      ...slot,
      lifecycle: 'failed',
      exitStatus,
      reason: exitStatus === null ? 'pane-exit-unknown' : 'pane-exit-nonzero',
    });
  }

  return classified;
}

export async function mergeReadySlots(
  issueId: string,
  workspacePath: string,
  doc: VBriefDocument,
  slots: ClassifiedSwarmSlot[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'verifyAndMergeSlot' | 'applyTaskOperationToPlanFile'> = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const itemsById = new Map(doc.plan.items.map(item => [item.id, item]));
  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

  for (const slot of slots) {
    if (slot.lifecycle !== 'ready-to-merge') continue;

    const item = itemsById.get(slot.itemId);
    if (!item) continue;

    const result = await deps.verifyAndMergeSlot({ issueId, featureWorkspace: workspacePath }, slot.slotIndex, item);
    if (result.merged) {
      await deps.applyTaskOperationToPlanFile(planPath, {
        type: 'done',
        itemId: item.id,
        writerId: 'deacon-swarm',
      }, workspacePath);
      actions.push(`[swarm] merged slot ${slot.slotIndex} (item ${item.id}) for ${issueId}`);
      continue;
    }

    if (result.conflicts) {
      actions.push(`[swarm] failed-merge slot ${slot.slotIndex} (item ${item.id}) for ${issueId}`);
    }
  }

  return actions;
}
