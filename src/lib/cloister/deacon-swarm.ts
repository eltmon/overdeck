import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { join } from 'path';
import { spawnRun } from '../agents/spawn.js';
import type { SpawnRunOptions } from '../agents/spawn-prep.js';
import { verifyAndMergeSlot, type SlotMergeResult } from '../agents/slot-merge.js';
import { reconcileSlotState, type ReconciledSlotItem, type SlotReconcileResult } from '../agents/slot-reconcile.js';
import { listAgentStates } from '../agents/queries.js';
import { findSpecByIssue } from '../pan-dir/specs.js';
import { isPaneDead, listPaneValues, listSessionNames as listTmuxSessionNames } from '../tmux.js';
import {
  applyTaskOperationToPlanFile,
  blockingParentCount,
  createActiveSlice,
  getDispatchableItems,
  type PersistedTaskOperation,
} from '../vbrief/dag.js';
import { analyzeSwarmReadiness, type SwarmReadinessVerdict } from '../vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../vbrief/types.js';
import { getConcurrencyLimits, releaseAdvancingSlot, tryReserveAdvancingSlot } from './concurrency.js';
import { listFeatureWorkspaces, type FeatureWorkspace } from './deacon-workspaces.js';

const execAsync = promisify(exec);
const SLOT_MERGE_REFIRE_COOLDOWN_MS = 5_000;
const SWARM_ADVANCE_FAILURE_THRESHOLD = 3;
const SWARM_ADVANCE_FAILURE_COOLDOWN_MS = 60_000;

const recentSlotMergeFires = new Map<string, number>();
const issueAdvanceFailures = new Map<string, { count: number; cooldownUntil: number }>();

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
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  registeredSlotCapacityAvailable: (issueId: string, selectedCount: number) => boolean;
  tryReserveAdvancingSlot: () => boolean;
  releaseAdvancingSlot: () => void;
  spawnRun: (issueId: string, role: 'work', options: SpawnRunOptions) => Promise<unknown>;
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
  runGitCommand: (command, cwd) => execAsync(command, { cwd }),
  registeredSlotCapacityAvailable: (issueId, selectedCount) => registeredSlotCapacityAvailable(issueId, selectedCount),
  tryReserveAdvancingSlot,
  releaseAdvancingSlot,
  spawnRun,
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
    if (isSwarmAdvanceCoolingDown(issueId)) {
      actions.push(`[swarm] deferred ${issueId}: advance backoff active`);
      continue;
    }

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
      actions.push(...await gcMergedSlots(issueId, workspace.workspacePath, reconciled.merged, deps));
      actions.push(...await dispatchNextWave(issueId, workspace.workspacePath, spec.document, reconciled, readiness, deps));
      recordSwarmAdvanceSuccess(issueId);
    } catch (err) {
      recordSwarmAdvanceFailure(issueId);
      console.warn(`[deacon] Error coordinating swarm ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return actions;
}

export async function gcMergedSlots(
  issueId: string,
  workspacePath: string,
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'runGitCommand'> = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];

  for (const slot of slots) {
    if (slot.status !== 'merged') continue;

    const slotWorkspace = `${workspacePath}-slot-${slot.slotIndex}`;
    const slotBranch = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;

    await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`, workspacePath);
    await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, workspacePath);
    actions.push(`[swarm] gc slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}`);
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

    const branchKey = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;
    if (isSlotMergeCoolingDown(branchKey)) {
      actions.push(`[swarm] skipped merge slot ${slot.slotIndex} (item ${item.id}) for ${issueId}: refire cooldown`);
      continue;
    }

    recordSlotMergeFire(branchKey);
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

export function resetSwarmLoopSafetyForTests(): void {
  recentSlotMergeFires.clear();
  issueAdvanceFailures.clear();
}

export function recordSwarmAdvanceFailure(issueId: string, now = Date.now()): void {
  const normalized = issueId.toUpperCase();
  const previous = issueAdvanceFailures.get(normalized);
  const count = (previous?.count ?? 0) + 1;
  issueAdvanceFailures.set(normalized, {
    count,
    cooldownUntil: count >= SWARM_ADVANCE_FAILURE_THRESHOLD
      ? now + SWARM_ADVANCE_FAILURE_COOLDOWN_MS
      : previous?.cooldownUntil ?? 0,
  });
}

export function recordSwarmAdvanceSuccess(issueId: string): void {
  issueAdvanceFailures.delete(issueId.toUpperCase());
}

export function isSwarmAdvanceCoolingDown(issueId: string, now = Date.now()): boolean {
  const record = issueAdvanceFailures.get(issueId.toUpperCase());
  return record !== undefined && record.cooldownUntil > now;
}

function recordSlotMergeFire(branchKey: string, now = Date.now()): void {
  recentSlotMergeFires.set(branchKey, now + SLOT_MERGE_REFIRE_COOLDOWN_MS);
}

function isSlotMergeCoolingDown(branchKey: string, now = Date.now()): boolean {
  const until = recentSlotMergeFires.get(branchKey);
  if (until === undefined) return false;
  if (until > now) return true;
  recentSlotMergeFires.delete(branchKey);
  return false;
}

export async function dispatchNextWave(
  issueId: string,
  workspacePath: string,
  doc: VBriefDocument,
  reconciled: SlotReconcileResult,
  readiness: SwarmReadinessVerdict,
  deps: Pick<
    CoordinateSwarmSlotsDeps,
    'registeredSlotCapacityAvailable'
    | 'tryReserveAdvancingSlot'
    | 'releaseAdvancingSlot'
    | 'applyTaskOperationToPlanFile'
    | 'spawnRun'
  > = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const mergedItemIds = new Set(reconciled.merged.map(slot => slot.itemId));
  const slotEligibleIds = new Set(readiness.items.filter(item => item.slotEligible).map(item => item.id));
  const occupiedSlotIndexes = new Set(reconciled.inFlight.map(slot => slot.slotIndex));
  const inFlightItemIds = new Set(reconciled.inFlight.map(slot => slot.itemId));
  const selectedItemIds: string[] = [];
  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

  for (const item of getDispatchableItems(doc, mergedItemIds)) {
    if (!slotEligibleIds.has(item.id)) continue;
    if (inFlightItemIds.has(item.id)) continue;

    const overlapItemId = firstOverlappingItemId(item.id, [...inFlightItemIds, ...selectedItemIds], readiness);
    if (overlapItemId) {
      actions.push(`[swarm] deferred ${item.id} for ${issueId}: files_scope overlaps ${overlapItemId}`);
      continue;
    }

    if (!deps.registeredSlotCapacityAvailable(issueId, selectedItemIds.length)) {
      actions.push(`[swarm] deferred ${item.id} for ${issueId}: registered slot cap reached`);
      continue;
    }

    const slotIndex = lowestFreeSlotIndex(occupiedSlotIndexes);
    if (!deps.tryReserveAdvancingSlot()) {
      actions.push(`[swarm] deferred ${item.id} for ${issueId}: advancing dispatch budget exhausted`);
      continue;
    }

    try {
      await deps.applyTaskOperationToPlanFile(planPath, {
        type: 'claim',
        itemId: item.id,
        writerId: 'deacon-swarm',
      }, workspacePath);
      await deps.spawnRun(issueId, 'work', {
        workspace: workspacePath,
        slotIndex,
        slotItemId: item.id,
        prompt: promptForDispatchItem(issueId, doc, item),
      });
      occupiedSlotIndexes.add(slotIndex);
      selectedItemIds.push(item.id);
      actions.push(`[swarm] dispatched ${dispatchPhaseForItem(doc, item)} slot ${slotIndex} (item ${item.id}) for ${issueId}`);
    } catch (error) {
      await deps.applyTaskOperationToPlanFile(planPath, {
        type: 'unblock',
        itemId: item.id,
        writerId: 'deacon-swarm',
        reason: `slot dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      }, workspacePath).catch(() => undefined);
      deps.releaseAdvancingSlot();
      actions.push(`[swarm] failed-dispatch ${item.id} for ${issueId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return actions;
}

function dispatchPhaseForItem(doc: VBriefDocument, item: VBriefItem): 'implementation' | 'synthesis' {
  return itemRequiresSynthesis(doc, item) && !synthesisContextForItem(item) ? 'synthesis' : 'implementation';
}

function promptForDispatchItem(issueId: string, doc: VBriefDocument, item: VBriefItem): string | undefined {
  if (!itemRequiresSynthesis(doc, item)) return undefined;

  const synthesisContext = synthesisContextForItem(item);
  if (synthesisContext) {
    return createActiveSlice(doc, {
      issueId,
      itemId: item.id,
      currentItemIds: [item.id],
      synthesisOutputs: { [item.id]: { contextUpdate: synthesisContext } },
    }).prompt;
  }

  const parentIds = doc.plan.edges
    .filter(edge => edge.type === 'blocks' && edge.to === item.id)
    .map(edge => edge.from);

  return [
    `SYNTHESIS PHASE for ${item.id}`,
    '',
    'Do not implement this item yet. Summarize the blocking parent outputs into a concise context update for the implementation slot.',
    `Blocking parents: ${parentIds.join(', ') || '(none)'}`,
    '',
    'Persist the synthesis context on the vBRIEF item metadata as synthesisContext, commit it, then stop.',
  ].join('\n');
}

function itemRequiresSynthesis(doc: VBriefDocument, item: VBriefItem): boolean {
  return item.metadata?.requiresSynthesis === true || blockingParentCount(doc, item.id) > 1;
}

function synthesisContextForItem(item: VBriefItem): string | undefined {
  const raw = item.metadata?.synthesisContext;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
}

function lowestFreeSlotIndex(occupiedSlotIndexes: Set<number>): number {
  let slotIndex = 1;
  while (occupiedSlotIndexes.has(slotIndex)) slotIndex++;
  return slotIndex;
}

function firstOverlappingItemId(
  itemId: string,
  activeItemIds: string[],
  readiness: SwarmReadinessVerdict,
): string | undefined {
  for (const activeItemId of activeItemIds) {
    if ((readiness.overlapMatrix[itemId]?.[activeItemId]?.length ?? 0) > 0) return activeItemId;
  }
  return undefined;
}

function registeredSlotCapacityAvailable(issueId: string, selectedCount: number): boolean {
  const cap = getConcurrencyLimits().maxWorkAgents;
  const issueLower = issueId.toLowerCase();
  const slotAgentPattern = new RegExp(`^agent-${escapeRegExp(issueLower)}-slot-\\d+$`);
  const activeSlots = listAgentStates({ role: 'work' }).filter(agent =>
    slotAgentPattern.test(agent.id)
    && (agent.status === 'starting' || agent.status === 'running')
  );
  return activeSlots.length + selectedCount < cap;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
