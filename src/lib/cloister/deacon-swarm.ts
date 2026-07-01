import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { join } from 'path';
import { getAgentRuntimeSnapshot } from '../agent-runtime.js';
import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import { spawnRun } from '../agents/spawn.js';
import type { SpawnRunOptions } from '../agents/spawn-prep.js';
import { verifyAndMergeSlot, type SlotMergeResult } from '../agents/slot-merge.js';
import { reconcileSlotState, type ReconciledSlotItem, type SlotReconcileResult } from '../agents/slot-reconcile.js';
import { listAgentStates } from '../agents/queries.js';
import {
  readIssueRecordForWorkspaceSync,
  writeIssueRecordForWorkspaceSync,
  type PanIssueRecord,
} from '../pan-dir/record.js';
import { findSpecByIssue } from '../pan-dir/specs.js';
import { capturePane, isPaneDead, listPaneValues, listSessionNames as listTmuxSessionNames } from '../tmux.js';
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
const DEFAULT_SWARM_STALL_THRESHOLD_MS = 30 * 60 * 1000;

const recentSlotMergeFires = new Map<string, number>();
const issueAdvanceFailures = new Map<string, { count: number; cooldownUntil: number }>();
const failedMergeBlocks = new Map<string, FailedMergeBlock>();
const slotProgressObservations = new Map<string, SlotProgressObservation>();

export type SwarmRecoveryAction = 'retry' | 'drop' | 'handoff';

export interface FailedMergeBlock {
  issueId: string;
  itemId: string;
  slotIndex: number;
  branch?: string;
  note: string;
}

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
  getAgentRuntimeState: (agentId: string) => Promise<Pick<AgentRuntimeSnapshot, 'resolution'> | null>;
  getPaneOutputDigest: (sessionName: string) => Promise<string>;
  getBranchTipCommitTime: (workspacePath: string, branch: string) => Promise<number | null>;
  slotWorktreeExists: (slotWorkspacePath: string) => boolean;
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
  recordSlotAssignment: (workspacePath: string, issueId: string, assignment: SlotAssignment) => void;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => void;
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
  getAgentRuntimeState: (agentId) => Effect.runPromise(getAgentRuntimeSnapshot(agentId)),
  getPaneOutputDigest: async (sessionName) => Effect.runPromise(capturePane(sessionName, 200)),
  getBranchTipCommitTime: async (workspacePath, branch) => {
    try {
      const { stdout } = await execAsync(`git log -1 --format=%ct ${JSON.stringify(branch)}`, { cwd: workspacePath });
      const seconds = Number(stdout.trim());
      return Number.isFinite(seconds) ? seconds * 1000 : null;
    } catch {
      return null;
    }
  },
  slotWorktreeExists: existsSync,
  verifyAndMergeSlot,
  applyTaskOperationToPlanFile: (planPath, operation, workspacePath) =>
    Effect.runPromise(applyTaskOperationToPlanFile(planPath, operation, workspacePath)),
  recordSlotAssignment,
  clearSlotAssignment,
  runGitCommand: (command, cwd) => execAsync(command, { cwd }),
  registeredSlotCapacityAvailable: (issueId, selectedCount) => registeredSlotCapacityAvailable(issueId, selectedCount),
  tryReserveAdvancingSlot,
  releaseAdvancingSlot,
  spawnRun,
};

export type SwarmSlotLifecycle = 'running' | 'ready-to-merge' | 'failed' | 'stalled';

export interface ClassifyInFlightSlotsOptions {
  workspacePath?: string;
  stallThresholdMs?: number;
  now?: number;
}

export interface ClassifiedSwarmSlot extends ReconciledSlotItem {
  lifecycle: SwarmSlotLifecycle;
  exitStatus?: number | null;
  reason?: 'missing-agent' | 'vanished-session' | 'pane-exit-nonzero' | 'pane-exit-unknown' | 'no-progress-timeout';
  stalledForMs?: number;
}

interface SlotProgressObservation {
  commitTime: number | null;
  outputDigest: string;
  lastProgressAt: number;
}

interface SlotAssignment {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
}

type SlotAssignments = NonNullable<NonNullable<PanIssueRecord['swarm']>['slotAssignments']>;

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
    const failedMergeBlock = getFailedMergeBlock(issueId, workspace.workspacePath);
    if (failedMergeBlock) {
      actions.push(`[swarm] blocked ${issueId}: failed-merge slot ${failedMergeBlock.slotIndex} (item ${failedMergeBlock.itemId})`);
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
      const classified = await classifyInFlightSlots(reconciled.inFlight, deps, { workspacePath: workspace.workspacePath });
      for (const slot of classified) {
        actions.push(`[swarm] ${issueId} slot ${slot.slotIndex} ${slot.lifecycle}`);
      }
      actions.push(...recordStalledSlotRecovery(issueId, classified, workspace.workspacePath));
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
  deps: Pick<CoordinateSwarmSlotsDeps, 'runGitCommand' | 'clearSlotAssignment'> = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];

  for (const slot of slots) {
    if (slot.status !== 'merged') continue;

    const slotWorkspace = `${workspacePath}-slot-${slot.slotIndex}`;
    const slotBranch = slot.branch ?? `feature/${issueId.toLowerCase()}-slot-${slot.slotIndex}`;

    await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(slotWorkspace)}`, workspacePath);
    await deps.runGitCommand(`git branch -D ${JSON.stringify(slotBranch)}`, workspacePath);
    deps.clearSlotAssignment(workspacePath, issueId, slot.slotIndex, slot.itemId);
    actions.push(`[swarm] gc slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}`);
  }

  return actions;
}

export async function classifyInFlightSlots(
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'isPaneDead' | 'getPaneExitStatus'>
    & Partial<Pick<CoordinateSwarmSlotsDeps, 'getAgentRuntimeState' | 'getPaneOutputDigest' | 'getBranchTipCommitTime'>> = defaultDeps,
  options: ClassifyInFlightSlotsOptions = {},
): Promise<ClassifiedSwarmSlot[]> {
  const sessionNames = new Set(await deps.listSessionNames());
  const classified: ClassifiedSwarmSlot[] = [];
  const now = options.now ?? Date.now();
  const stallThresholdMs = options.stallThresholdMs ?? swarmStallThresholdMs();

  for (const slot of slots) {
    if (!slot.agentId) {
      classified.push({ ...slot, lifecycle: 'failed', reason: 'missing-agent' });
      continue;
    }

    const runtimeState = deps.getAgentRuntimeState ? await deps.getAgentRuntimeState(slot.agentId) : null;
    if (runtimeState?.resolution === 'done' || runtimeState?.resolution === 'completed') {
      classified.push({ ...slot, lifecycle: 'ready-to-merge', exitStatus: 0 });
      continue;
    }

    if (!sessionNames.has(slot.agentId)) {
      classified.push({ ...slot, lifecycle: 'failed', reason: 'vanished-session' });
      continue;
    }

    const dead = await deps.isPaneDead(slot.agentId);
    if (!dead) {
      const outputDigest = deps.getPaneOutputDigest
        ? await deps.getPaneOutputDigest(slot.agentId).catch(() => '')
        : '';
      const commitTime = slot.branch && options.workspacePath && deps.getBranchTipCommitTime
        ? await deps.getBranchTipCommitTime(options.workspacePath, slot.branch).catch(() => null)
        : null;
      const progressKey = slotProgressKey(slot);
      const previous = slotProgressObservations.get(progressKey);
      if (
        !previous
        || previous.commitTime !== commitTime
        || previous.outputDigest !== outputDigest
      ) {
        slotProgressObservations.set(progressKey, { commitTime, outputDigest, lastProgressAt: now });
        classified.push({ ...slot, lifecycle: 'running' });
        continue;
      }

      const stalledForMs = now - previous.lastProgressAt;
      if (stalledForMs > stallThresholdMs) {
        classified.push({
          ...slot,
          lifecycle: 'stalled',
          reason: 'no-progress-timeout',
          stalledForMs,
        });
        continue;
      }

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

function slotProgressKey(slot: ReconciledSlotItem): string {
  return slot.agentId ?? slot.branch ?? `${slot.itemId}:${slot.slotIndex}`;
}

function swarmStallThresholdMs(): number {
  const raw = process.env.PAN_SWARM_STALL_THRESHOLD_MS;
  if (!raw) return DEFAULT_SWARM_STALL_THRESHOLD_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SWARM_STALL_THRESHOLD_MS;
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
      recordFailedMergeBlock({
        issueId,
        itemId: item.id,
        slotIndex: slot.slotIndex,
        branch: slot.branch,
        note: `Slot branch ${slot.branch ?? slot.slotIndex} did not merge cleanly`,
      }, workspacePath);
      actions.push(`[swarm] failed-merge slot ${slot.slotIndex} (item ${item.id}) for ${issueId}`);
    }
  }

  return actions;
}

export function resetSwarmLoopSafetyForTests(): void {
  recentSlotMergeFires.clear();
  issueAdvanceFailures.clear();
  failedMergeBlocks.clear();
  slotProgressObservations.clear();
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

export function getFailedMergeBlock(issueId: string, workspacePath?: string): FailedMergeBlock | undefined {
  const normalized = issueId.toUpperCase();
  if (workspacePath) {
    const durable = readIssueRecordForWorkspaceSync(workspacePath, normalized)?.swarm?.failedMergeBlock;
    if (durable) return { ...durable, issueId: durable.issueId.toUpperCase() };
  }
  return failedMergeBlocks.get(normalized);
}

export function recordFailedMergeBlock(block: FailedMergeBlock, workspacePath?: string): void {
  const normalizedBlock = { ...block, issueId: block.issueId.toUpperCase() };
  failedMergeBlocks.set(normalizedBlock.issueId, normalizedBlock);
  if (workspacePath) writeSwarmFailedMergeBlock(workspacePath, normalizedBlock.issueId, normalizedBlock);
}

function clearFailedMergeBlock(issueId: string, workspacePath?: string): void {
  const normalizedIssueId = issueId.toUpperCase();
  failedMergeBlocks.delete(normalizedIssueId);
  if (workspacePath) writeSwarmFailedMergeBlock(workspacePath, normalizedIssueId, undefined);
}

export async function recoverFailedMergeSlot(
  issueId: string,
  workspacePath: string,
  doc: VBriefDocument,
  action: SwarmRecoveryAction,
  deps: Pick<
    CoordinateSwarmSlotsDeps,
    'applyTaskOperationToPlanFile'
    | 'clearSlotAssignment'
    | 'recordSlotAssignment'
    | 'registeredSlotCapacityAvailable'
    | 'tryReserveAdvancingSlot'
    | 'releaseAdvancingSlot'
    | 'spawnRun'
  > = defaultDeps,
): Promise<string[]> {
  const normalizedIssueId = issueId.toUpperCase();
  const block = getFailedMergeBlock(normalizedIssueId, workspacePath);
  if (!block) return [`[swarm] no failed-merge slot for ${normalizedIssueId}`];

  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');
  if (action === 'handoff') {
    block.note = `Operator handoff required for slot ${block.slotIndex} (item ${block.itemId})`;
    recordFailedMergeBlock(block, workspacePath);
    return [`[swarm] handoff paused ${normalizedIssueId} slot ${block.slotIndex} (item ${block.itemId})`];
  }

  if (action === 'drop') {
    await deps.applyTaskOperationToPlanFile(planPath, {
      type: 'done',
      itemId: block.itemId,
      writerId: 'deacon-swarm',
      reason: 'Dropped failed swarm slot after operator recovery',
    }, workspacePath);
    clearFailedMergeBlock(normalizedIssueId, workspacePath);
    deps.clearSlotAssignment(workspacePath, normalizedIssueId, block.slotIndex, block.itemId);
    return [`[swarm] dropped failed-merge slot ${block.slotIndex} (item ${block.itemId}) for ${normalizedIssueId}`];
  }

  await deps.applyTaskOperationToPlanFile(planPath, {
    type: 'unblock',
    itemId: block.itemId,
    writerId: 'deacon-swarm',
    reason: 'Retrying failed swarm slot after merge conflict',
  }, workspacePath);
  clearFailedMergeBlock(normalizedIssueId, workspacePath);
  const retryDoc = {
    ...doc,
    plan: {
      ...doc.plan,
      items: doc.plan.items.map(item =>
        item.id === block.itemId ? { ...item, status: 'pending' as const } : item
      ),
    },
  };
  return [
    `[swarm] retrying failed-merge slot ${block.slotIndex} (item ${block.itemId}) for ${normalizedIssueId}`,
    ...await dispatchNextWave(normalizedIssueId, workspacePath, retryDoc, {
      issueId: normalizedIssueId,
      merged: [],
      inFlight: [],
      pending: [],
      branches: [],
      agents: [],
    }, analyzeSwarmReadiness(retryDoc), deps),
  ];
}

export function recordStalledSlotRecovery(issueId: string, slots: ClassifiedSwarmSlot[], workspacePath?: string): string[] {
  const actions: string[] = [];
  const normalizedIssueId = issueId.toUpperCase();
  if (getFailedMergeBlock(normalizedIssueId, workspacePath)) return actions;

  const stalled = slots.find(slot => slot.lifecycle === 'stalled');
  if (!stalled) return actions;

  recordFailedMergeBlock({
    issueId: normalizedIssueId,
    itemId: stalled.itemId,
    slotIndex: stalled.slotIndex,
    branch: stalled.branch,
    note: `Slot ${stalled.slotIndex} stalled with no branch commit or pane output progress`,
  }, workspacePath);
  actions.push(`[swarm] stalled slot ${stalled.slotIndex} (item ${stalled.itemId}) for ${normalizedIssueId}: recovery required`);
  return actions;
}

function writeSwarmFailedMergeBlock(
  workspacePath: string,
  issueId: string,
  block: FailedMergeBlock | undefined,
): void {
  const normalizedIssueId = issueId.toUpperCase();
  const existing = readIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId);
  const record = existing ?? createMinimalIssueRecord(normalizedIssueId);
  writeIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId, {
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      failedMergeBlock: block,
    },
  });
}

function createMinimalIssueRecord(issueId: string): PanIssueRecord {
  const now = new Date().toISOString();
  return {
    issueId,
    schemaVersion: 2,
    created: now,
    updated: now,
    feedback: [],
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: now,
    },
    closeOut: {
      usage: {
        byStage: {},
        totals: {},
      },
      merges: [],
      ranOn: '',
    },
  };
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
    | 'recordSlotAssignment'
    | 'clearSlotAssignment'
    | 'spawnRun'
  > & Partial<Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'slotWorktreeExists'>> = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const mergedItemIds = new Set(reconciled.merged.map(slot => slot.itemId));
  const slotEligibleIds = new Set(readiness.items.filter(item => item.slotEligible).map(item => item.id));
  const occupiedSlotIndexes = new Set([
    ...reconciled.inFlight.map(slot => slot.slotIndex),
    ...reconciled.branches.filter(branch => !branch.merged).map(branch => branch.slotIndex),
    ...reconciled.agents.map(agent => agent.slotIndex),
  ]);
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
    const duplicateReason = await duplicateSpawnReason(issueId, workspacePath, item.id, slotIndex, reconciled, deps);
    if (duplicateReason) {
      actions.push(`[swarm] refused ${item.id} for ${issueId}: ${duplicateReason}`);
      continue;
    }

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
      deps.recordSlotAssignment(workspacePath, issueId, {
        slotIndex,
        itemId: item.id,
        agentId: `agent-${issueId.toLowerCase()}-slot-${slotIndex}`,
        branch: `feature/${issueId.toLowerCase()}-slot-${slotIndex}`,
      });
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
      deps.clearSlotAssignment(workspacePath, issueId, slotIndex, item.id);
      deps.releaseAdvancingSlot();
      actions.push(`[swarm] failed-dispatch ${item.id} for ${issueId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return actions;
}

function recordSlotAssignment(workspacePath: string, issueId: string, assignment: SlotAssignment): void {
  writeSwarmSlotAssignments(workspacePath, issueId, (existing) => [
    ...existing.filter(slot => slot.slotIndex !== assignment.slotIndex && slot.itemId !== assignment.itemId),
    {
      ...assignment,
      assignedAt: new Date().toISOString(),
    },
  ]);
}

function clearSlotAssignment(workspacePath: string, issueId: string, slotIndex: number, itemId?: string): void {
  writeSwarmSlotAssignments(workspacePath, issueId, (existing) =>
    existing.filter(slot => slot.slotIndex !== slotIndex && (itemId === undefined || slot.itemId !== itemId))
  );
}

function writeSwarmSlotAssignments(
  workspacePath: string,
  issueId: string,
  update: (existing: SlotAssignments) => SlotAssignments,
): void {
  const normalizedIssueId = issueId.toUpperCase();
  const existing = readIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId);
  const record = existing ?? createMinimalIssueRecord(normalizedIssueId);
  const existingAssignments: SlotAssignments = record.swarm?.slotAssignments ?? [];
  const slotAssignments = update(existingAssignments)
    .filter(assignment => Number.isInteger(assignment.slotIndex) && assignment.slotIndex > 0 && assignment.itemId.trim().length > 0)
    .sort((a, b) => a.slotIndex - b.slotIndex);

  writeIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId, {
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      slotAssignments,
    },
  });
}

async function duplicateSpawnReason(
  issueId: string,
  workspacePath: string,
  itemId: string,
  slotIndex: number,
  reconciled: SlotReconcileResult,
  deps: Partial<Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'slotWorktreeExists'>>,
): Promise<string | undefined> {
  const issueLower = issueId.toLowerCase();
  const agentId = `agent-${issueLower}-slot-${slotIndex}`;
  const branch = `feature/${issueLower}-slot-${slotIndex}`;
  const sessionNames = deps.listSessionNames ? await deps.listSessionNames() : [];
  if (sessionNames.includes(agentId)) {
    return `live ${agentId} session already exists`;
  }

  const unmergedBranch = reconciled.branches.find(slotBranch =>
    slotBranch.slotIndex === slotIndex && slotBranch.branch === branch && !slotBranch.merged
  );
  if (unmergedBranch) {
    return `unmerged ${branch} branch already exists`;
  }

  const slotWorkspacePath = `${workspacePath}-slot-${slotIndex}`;
  if (deps.slotWorktreeExists?.(slotWorkspacePath)) {
    return `slot worktree already exists at ${slotWorkspacePath}`;
  }

  const duplicateItem = reconciled.inFlight.find(slot => slot.itemId === itemId);
  if (duplicateItem) {
    return `item already in flight on slot ${duplicateItem.slotIndex}`;
  }

  return undefined;
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
