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
import {
  listSlotAssignments as listDurableSlotAssignments,
  reconcileSlotState,
  type ReconciledSlotItem,
  type SlotReconcileResult,
} from '../agents/slot-reconcile.js';
import {
  readIssueRecordForWorkspaceSync,
  writeIssueRecordForWorkspaceSync,
  getIssueRecordPathForWorkspace,
  type PanIssueRecord,
  type PanIssueSwarmFailedMergeBlock,
  type PanIssueSwarmSlotCompletion,
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
import { applyStatusOverrides } from '../vbrief/io.js';
import { analyzeSwarmReadiness, type SwarmReadinessVerdict } from '../vbrief/swarm-readiness.js';
import type { VBriefDocument, VBriefItem } from '../vbrief/types.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { isDeaconGloballyPausedSync } from '../overdeck/control-settings.js';
import type { SwarmInferCompletionMode } from './config.js';
import {
  countRunningSwarmSlotsForIssue,
  getConcurrencyLimits,
  releaseSwarmSlot,
  tryReserveSwarmSlot,
  type ConcurrencyLimits,
} from './concurrency.js';
import { listFeatureWorkspaces, type FeatureWorkspace } from './deacon-workspaces.js';
import { gcOrphanedSlots } from './deacon-swarm-orphan-gc.js';
import {
  classifyDoneWithoutSignal,
  classifyDurableReadySlot,
  clearSwarmCompletionObservation,
  defaultGetSlotBranchAheadCount,
  defaultIsSlotWorktreeClean,
  defaultSendCompletionNudge,
  resetSwarmCompletionInferenceForTests,
  swarmInferCompletionMode,
} from './deacon-swarm-completion.js';
import {
  defaultRequestIssueReview,
  finalizeSwarmIssueIfComplete,
  type RequestIssueReviewResult,
} from './deacon-swarm-finalization.js';
import { gcMergedSlots } from './deacon-swarm-gc.js';
import { createMinimalIssueRecord, writeSwarmFinalizedAt, clearSwarmSlotCompletion } from './deacon-swarm-record.js';
import { fireTieredCommitHooks } from './swarm-tiered-hooks.js';
import { applySupersededSlotHighWater, archiveFailedSwarmSlot, requeueFailedSwarmSlots } from './swarm-failed-slot.js';

export { gcOrphanedSlots } from './deacon-swarm-orphan-gc.js';
export { gcMergedSlots } from './deacon-swarm-gc.js';

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
  getSlotBranchAheadCount: (workspacePath: string, issueId: string, branch: string) => Promise<number>;
  isSlotWorktreeClean: (slotWorkspacePath: string) => Promise<boolean>;
  sendCompletionNudge: (agentId: string, issueId: string) => Promise<void>;
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
  /** PAN-2385: fire the tiered commit feed + supervisor review after a slot merges. */
  fireTieredCommitHooks: (
    options: { issueId: string; workspacePath: string; item: VBriefItem; doc: VBriefDocument },
  ) => Promise<string[]>;
  recordSlotAssignment: (workspacePath: string, issueId: string, assignment: SlotAssignment) => void;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => void;
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  registeredSlotCapacityAvailable: (issueId: string, selectedCount: number) => boolean;
  tryReserveSwarmSlot: () => boolean;
  releaseSwarmSlot: () => void;
  spawnRun: (issueId: string, role: 'work', options: SpawnRunOptions) => Promise<unknown>;
  /** Per-issue hold: deaconIgnored (operator) suppresses all swarm coordination (PAN-2214);
   *  system-set `stuck` is logged but no longer halts coordination (PAN-2469). */
  getIssueHold?: (issueId: string) => Pick<ReviewStatus, 'stuck' | 'deaconIgnored' | 'stuckReason'> | null;
  /** Per-issue record statusOverrides — the durable item done-ness the merged plan view applies. */
  readStatusOverrides?: (workspacePath: string, issueId: string) => Record<string, string> | undefined;
  /**
   * PAN-2372 WI-4 / FR-6: durable per-slot completion marker (written by slot
   * `pan done`). When present for a slot, it beats every other classification —
   * even a vanished session or missing agent — because it is the durable record
   * that the slot finished; the runtime plane is rebuildable and may be absent.
   */
  readSlotCompletion?: (workspacePath: string, issueId: string, slotIndex: number) => PanIssueSwarmSlotCompletion | undefined;
  getFinalizedAt: (issueId: string, workspacePath: string) => string | undefined;
  setFinalizedAt: (issueId: string, workspacePath: string, finalizedAt: string) => void;
  /**
   * Re-evaluated immediately before EVERY slot spawn: global freeze + per-issue hold.
   * The cycle-start checks alone let an in-flight wave keep dispatching after a freeze
   * activates mid-patrol (PAN-2214 slot-20 regression).
   */
  shouldDispatch?: (issueId: string) => boolean;
  /**
   * Inclusive upper bound for slot index allocation — the swarm reserve.
   * Unbounded allocation climbed slot-5..slot-20 under an inconsistent
   * registry (PAN-2214).
   */
  getMaxSlotIndex?: () => number;
  /** Durable slot assignments from the issue record; they survive registry resets (PAN-2214). */
  listSlotAssignments?: (issueId: string, workspacePath: string) => Array<{ slotIndex: number }>;
  /** Request issue-level review once every swarm item has been assembled into the feature branch. */
  requestIssueReview: (issueId: string, workspacePath: string) => Promise<RequestIssueReviewResult>;
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
  getSlotBranchAheadCount: defaultGetSlotBranchAheadCount,
  isSlotWorktreeClean: defaultIsSlotWorktreeClean,
  sendCompletionNudge: defaultSendCompletionNudge,
  slotWorktreeExists: existsSync,
  verifyAndMergeSlot,
  applyTaskOperationToPlanFile: (planPath, operation, workspacePath) =>
    Effect.runPromise(applyTaskOperationToPlanFile(planPath, operation, workspacePath)),
  fireTieredCommitHooks,
  recordSlotAssignment,
  clearSlotAssignment,
  runGitCommand: (command, cwd) => execAsync(command, { cwd }),
  registeredSlotCapacityAvailable: (issueId, selectedCount) => registeredSlotCapacityAvailable(issueId, selectedCount),
  tryReserveSwarmSlot,
  releaseSwarmSlot,
  spawnRun,
  getIssueHold: defaultGetIssueHold,
  shouldDispatch: defaultShouldDispatch,
  getMaxSlotIndex: defaultGetMaxSlotIndex,
  listSlotAssignments: listDurableSlotAssignments,
  readStatusOverrides: defaultReadStatusOverrides,
  readSlotCompletion: defaultReadSlotCompletion,
  getFinalizedAt: getSwarmFinalizedAt,
  setFinalizedAt: recordSwarmFinalizedAt,
  requestIssueReview: defaultRequestIssueReview,
};

function defaultGetMaxSlotIndex(): number {
  return Math.max(1, getConcurrencyLimits().reservedSwarmSlots);
}

function defaultGetIssueHold(issueId: string): Pick<ReviewStatus, 'stuck' | 'deaconIgnored' | 'stuckReason'> | null {
  try {
    return getReviewStatusSync(issueId);
  } catch {
    return null;
  }
}

function defaultReadStatusOverrides(workspacePath: string, issueId: string): Record<string, string> | undefined {
  // PAN-2372 WI-4 / FR-7: distinguish an absent record (silent undefined — a
  // brand-new issue that simply has no overrides yet) from an UNREADABLE record
  // (the file exists but won't parse). readIssueRecordForWorkspaceSync returns
  // null for both, so the existsSync check is what separates them. A corrupt
  // record is preserved as a .corrupt-<ts> sidecar by the atomic writer (WI-1);
  // warn so a broken sidecar never silently masks a slot's done-ness.
  const normalized = issueId.toUpperCase();
  const record = readIssueRecordForWorkspaceSync(workspacePath, normalized);
  if (record === null && existsSync(getIssueRecordPathForWorkspace(workspacePath, normalized))) {
    console.warn(`[swarm] record unreadable for ${normalized} — treating as no overrides; see .corrupt sidecar`);
    return undefined;
  }
  return record?.statusOverrides;
}

/**
 * PAN-2372 WI-4 / FR-6: read a slot's durable completion marker from the record
 * door. Returns undefined when no record or no marker exists. Used by
 * classifyInFlightSlots to recognize a slot whose `pan done` durably recorded
 * completion even when the runtime plane (agent state, tmux session) is gone.
 */
function defaultReadSlotCompletion(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
): PanIssueSwarmSlotCompletion | undefined {
  try {
    return readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase())?.swarm?.slotCompletions?.[String(slotIndex)];
  } catch {
    return undefined;
  }
}

function defaultShouldDispatch(issueId: string): boolean {
  if (isDeaconGloballyPausedSync()) return false;
  const hold = defaultGetIssueHold(issueId);
  return !(hold?.stuck || hold?.deaconIgnored);
}

export type SwarmSlotLifecycle = 'running' | 'ready-to-merge' | 'failed' | 'stalled' | 'awaiting-completion-signal';

export interface ClassifyInFlightSlotsOptions {
  workspacePath?: string;
  issueId?: string;
  inferCompletion?: SwarmInferCompletionMode;
  stallThresholdMs?: number;
  now?: number;
}

export interface ClassifiedSwarmSlot extends ReconciledSlotItem {
  lifecycle: SwarmSlotLifecycle;
  exitStatus?: number | null;
  reason?: 'missing-agent' | 'vanished-session' | 'pane-exit-nonzero' | 'pane-exit-unknown' | 'no-progress-timeout';
  stalledForMs?: number;
  signal?: 'inferred' | 'completion-nudge' | 'durable-completion';
  actions?: string[];
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
    const hold = (deps.getIssueHold ?? defaultGetIssueHold)(issueId);
    if (hold?.deaconIgnored) {
      actions.push(`[swarm] skipped ${issueId}: deacon-ignored — operator hold`);
      continue;
    }
    // PAN-2469: `stuck` is a SYSTEM-set failure marker (delivery/verification
    // trouble), not an operator hold — skipping coordination on it froze the
    // whole swarm forever: PAN-2388's slots sat ready-to-merge for hours while
    // the coordinator skipped the issue because the verification-gate deadlock
    // (PAN-2461) had marked it stuck. Coordination (merge/gc/endgame) continues
    // through system-stuck; only operator deacon-ignore fully halts it.
    if (hold?.stuck) {
      actions.push(`[swarm] ${issueId} is system-stuck (${hold.stuckReason ?? 'unknown'}) — coordinating anyway (stuck no longer halts assembly, PAN-2469)`);
    }
    if (isSwarmAdvanceCoolingDown(issueId)) {
      actions.push(`[swarm] deferred ${issueId}: advance backoff active`);
      continue;
    }
    const failedMergeBlocks = getFailedMergeBlocks(issueId, workspace.workspacePath);
    const blockedSlotIndexes = new Set(failedMergeBlocks.map(block => block.slotIndex));
    const blockedItemIds = new Set(failedMergeBlocks.map(block => block.itemId));
    if (failedMergeBlocks.length > 0) {
      const slots = failedMergeBlocks
        .map(block => `slot ${block.slotIndex} (item ${block.itemId})`)
        .join(', ');
      actions.push(`[swarm] blocked slots for ${issueId}: ${slots} — other slots continue; run \`pan swarm recover ${issueId} <slot>\``);
    }

    try {
      const spec = await Effect.runPromise(findSpecByIssue(workspace.projectPath, issueId));
      if (!spec) continue;
      const planStatus = spec.document.plan.status;
      if (planStatus === 'completed' || planStatus === 'cancelled') continue;

      // Coordinate against the merged plan view; slot done-ness lives in statusOverrides.
      const overrides = (deps.readStatusOverrides ?? defaultReadStatusOverrides)(workspace.workspacePath, issueId);
      const doc = overrides && Object.keys(overrides).length > 0
        ? applyStatusOverrides(spec.document, overrides)
        : spec.document;

      const readiness = analyzeSwarmReadiness(doc);
      const slotEligibleCount = readiness.items.filter(item => item.slotEligible).length;
      // Eligibility gates dispatch only; active swarms still need merge/gc/endgame passes.
      const swarmInProgress = Object.entries(overrides ?? {})
        .some(([key, value]) => !key.includes('.') && value === 'completed');
      const dispatchEligible = readiness.swarmEligible && (slotEligibleCount >= 2 || swarmInProgress);
      if (dispatchEligible) {
        actions.push(`[swarm] considered ${issueId}: swarm eligible`);
      }

      const reconciled = await deps.reconcileSlotState(issueId, workspace.workspacePath, doc);
      if (!dispatchEligible) {
        const hasSlotState = reconciled.merged.length > 0 || reconciled.inFlight.length > 0
          || reconciled.branches.length > 0 || reconciled.agents.length > 0;
        if (!hasSlotState) {
          actions.push(...await finalizeSwarmIssueIfComplete(issueId, workspace.workspacePath, doc, deps));
          continue;
        }
        actions.push(`[swarm] considered ${issueId}: endgame (merge/cleanup only)`);
      }
      const classified = await classifyInFlightSlots(reconciled.inFlight, deps, {
        workspacePath: workspace.workspacePath,
        issueId,
        inferCompletion: swarmInferCompletionMode(),
      });
      for (const slot of classified) {
        actions.push(`[swarm] ${issueId} slot ${slot.slotIndex} ${slot.lifecycle}${slot.signal ? ` signal: ${slot.signal}` : ''}`);
        if (slot.actions) actions.push(...slot.actions);
      }
      const requeue = await requeueFailedSwarmSlots(issueId, workspace.workspacePath, classified, doc, reconciled, deps, blockedSlotIndexes);
      actions.push(...requeue.actions);
      actions.push(...recordStalledSlotRecovery(issueId, classified, workspace.workspacePath)); // stalled slots remain operator-recoverable
      actions.push(...await mergeReadySlots(issueId, workspace.workspacePath, doc, classified, deps, blockedSlotIndexes));
      actions.push(...await gcMergedSlots(issueId, workspace.workspacePath, reconciled.merged, deps));
      actions.push(...await gcOrphanedSlots(issueId, workspace.workspacePath, reconciled, deps));
      actions.push(...await finalizeSwarmIssueIfComplete(issueId, workspace.workspacePath, spec.document, deps));
      if (dispatchEligible) {
        actions.push(...await dispatchNextWave(issueId, workspace.workspacePath, requeue.doc, reconciled, analyzeSwarmReadiness(requeue.doc), deps, blockedSlotIndexes, blockedItemIds));
      }
      recordSwarmAdvanceSuccess(issueId);
    } catch (err) {
      recordSwarmAdvanceFailure(issueId);
      console.warn(`[deacon] Error coordinating swarm ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return actions;
}

export async function classifyInFlightSlots(
  slots: ReconciledSlotItem[],
  deps: Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'isPaneDead' | 'getPaneExitStatus'>
    & Partial<Pick<
      CoordinateSwarmSlotsDeps,
      'getAgentRuntimeState'
      | 'getPaneOutputDigest'
      | 'getBranchTipCommitTime'
      | 'getSlotBranchAheadCount'
      | 'isSlotWorktreeClean'
      | 'sendCompletionNudge'
      | 'readSlotCompletion'
    >> = defaultDeps,
  options: ClassifyInFlightSlotsOptions = {},
): Promise<ClassifiedSwarmSlot[]> {
  const sessionNames = new Set(await deps.listSessionNames());
  const classified: ClassifiedSwarmSlot[] = [];
  const now = options.now ?? Date.now();
  const stallThresholdMs = options.stallThresholdMs ?? swarmStallThresholdMs();

  for (const slot of slots) {
    // PAN-2372 WI-4 / FR-6: a durable completion marker (written by slot
    // `pan done`) is the STRONGEST completion signal — it is the durable record
    // that the slot finished, so it beats a vanished session, a missing agent,
    // and the rebuildable runtime plane. Check it before everything else. The
    // itemId guard (AC2) ignores a stale marker left for a slot now bound to a
    // different item (e.g. after a re-plan rotated slot→item).
    if (options.workspacePath && options.issueId) {
      const completion = await (deps.readSlotCompletion ?? defaultReadSlotCompletion)(
        options.workspacePath,
        options.issueId,
        slot.slotIndex,
      );
      if (completion && (!completion.itemId || completion.itemId === slot.itemId)) {
        classified.push({ ...slot, lifecycle: 'ready-to-merge', exitStatus: 0, signal: 'durable-completion' });
        continue;
      }
    }

    const durableReady = await classifyDurableReadySlot(slot, deps, options);
    if (!slot.agentId) {
      if (durableReady) {
        classified.push(durableReady);
        continue;
      }
      classified.push({ ...slot, lifecycle: 'failed', reason: 'missing-agent' });
      continue;
    }

    const runtimeState = deps.getAgentRuntimeState ? await deps.getAgentRuntimeState(slot.agentId) : null;
    if (runtimeState?.resolution === 'done' || runtimeState?.resolution === 'completed') {
      classified.push({ ...slot, lifecycle: 'ready-to-merge', exitStatus: 0 });
      continue;
    }

    if (!sessionNames.has(slot.agentId)) {
      if (durableReady) {
        classified.push(durableReady);
        continue;
      }
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
        clearSwarmCompletionObservation(progressKey);
        classified.push({ ...slot, lifecycle: 'running' });
        continue;
      }

      const stalledForMs = now - previous.lastProgressAt;
      if (stalledForMs > stallThresholdMs) {
        const inferred = await classifyDoneWithoutSignal(slot, deps, options, {
          commitTime,
          outputDigest,
          progressKey,
          stalledForMs,
        });
        if (inferred) {
          classified.push(inferred);
          continue;
        }

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
  deps: Pick<CoordinateSwarmSlotsDeps, 'verifyAndMergeSlot' | 'applyTaskOperationToPlanFile' | 'fireTieredCommitHooks'> = defaultDeps,
  blockedSlotIndexes: Set<number> = new Set(),
): Promise<string[]> {
  const actions: string[] = [];
  const itemsById = new Map(doc.plan.items.map(item => [item.id, item]));
  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

  for (const slot of slots) {
    if (slot.lifecycle !== 'ready-to-merge') continue;

    if (blockedSlotIndexes.has(slot.slotIndex)) {
      actions.push(`[swarm] skipped merge slot ${slot.slotIndex} (item ${slot.itemId}) for ${issueId}: failed-merge block — awaiting \`pan swarm recover\``);
      continue;
    }

    const item = itemsById.get(slot.itemId);
    if (!item) {
      // PAN-2469: this skip was silent — a slot whose itemId drifted from the
      // current spec (e.g. after a re-plan) sat ready-to-merge forever with no
      // trace. Say so every pass.
      actions.push(`[swarm] cannot merge slot ${slot.slotIndex} for ${issueId}: itemId "${slot.itemId}" not in the current plan (spec drift?) — needs operator attention`);
      continue;
    }

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
      // PAN-2372 WI-4 / FR-6: the durable marker has done its job — the slot is
      // merged. Clear it so the same slotIndex can be re-dispatched later without
      // a stale "completed" marker falsely surfacing as ready-to-merge.
      clearSwarmSlotCompletion(workspacePath, issueId, slot.slotIndex);
      actions.push(`[swarm] merged slot ${slot.slotIndex} (item ${item.id}) for ${issueId}`);
      // PAN-2385: commits just landed — fire the tiered feed + supervisor review (best-effort).
      try {
        actions.push(...await deps.fireTieredCommitHooks({ issueId, workspacePath, item, doc }));
      } catch (err) {
        actions.push(`[tiered] commit hooks threw for ${issueId} item ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      continue;
    }

    // Verification failure (merged result fails typecheck/tests) previously
    // fell through with no action at all — the slot silently re-verified on
    // every pass with nobody told why. Surface the failure so the operator
    // or recovery machinery can act on it.
    actions.push(`[swarm] verify-failed slot ${slot.slotIndex} (item ${item.id}) for ${issueId}: ${result.failure ?? 'verification failed'}`);
  }

  return actions;
}

export function resetSwarmLoopSafetyForTests(): void {
  recentSlotMergeFires.clear();
  issueAdvanceFailures.clear();
  failedMergeBlocks.clear();
  slotProgressObservations.clear();
  resetSwarmCompletionInferenceForTests();
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

export function getFailedMergeBlock(
  issueId: string,
  slotIndex: number,
  workspacePath?: string,
): FailedMergeBlock | undefined {
  const normalized = issueId.toUpperCase();
  if (workspacePath) {
    const swarm = readIssueRecordForWorkspaceSync(workspacePath, normalized)?.swarm;
    const keyed = swarm?.failedMergeBlocks?.[String(slotIndex)];
    if (keyed) return { ...keyed, issueId: keyed.issueId.toUpperCase() };
    const legacy = swarm?.failedMergeBlock;
    if (legacy && legacy.slotIndex === slotIndex) {
      return { ...legacy, issueId: legacy.issueId.toUpperCase() };
    }
  }
  return failedMergeBlocks.get(`${normalized}:${slotIndex}`);
}

export function getFailedMergeBlocks(issueId: string, workspacePath?: string): FailedMergeBlock[] {
  const normalized = issueId.toUpperCase();
  const bySlot = new Map<number, FailedMergeBlock>();

  if (workspacePath) {
    const swarm = readIssueRecordForWorkspaceSync(workspacePath, normalized)?.swarm;
    if (swarm?.failedMergeBlock) {
      const legacy = swarm.failedMergeBlock;
      bySlot.set(legacy.slotIndex, { ...legacy, issueId: legacy.issueId.toUpperCase() });
    }
    if (swarm?.failedMergeBlocks) {
      for (const [key, block] of Object.entries(swarm.failedMergeBlocks)) {
        bySlot.set(Number(key), { ...block, issueId: block.issueId.toUpperCase() });
      }
    }
  }

  for (const [key, block] of failedMergeBlocks.entries()) {
    if (key.startsWith(`${normalized}:`) && !bySlot.has(block.slotIndex)) {
      bySlot.set(block.slotIndex, { ...block });
    }
  }

  return [...bySlot.values()].sort((a, b) => a.slotIndex - b.slotIndex);
}

export function getSwarmFinalizedAt(issueId: string, workspacePath?: string): string | undefined {
  return workspacePath ? readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase())?.swarm?.finalizedAt : undefined;
}

export function recordSwarmFinalizedAt(issueId: string, workspacePath: string, finalizedAt: string): void {
  writeSwarmFinalizedAt(workspacePath, issueId.toUpperCase(), finalizedAt);
}

export function recordFailedMergeBlock(block: FailedMergeBlock, workspacePath?: string): void {
  const normalizedBlock = { ...block, issueId: block.issueId.toUpperCase() };
  failedMergeBlocks.set(`${normalizedBlock.issueId}:${normalizedBlock.slotIndex}`, normalizedBlock);
  if (workspacePath) {
    writeSwarmFailedMergeBlock(workspacePath, normalizedBlock.issueId, normalizedBlock.slotIndex, normalizedBlock);
  }
}

export function clearFailedMergeBlock(issueId: string, slotIndex: number, workspacePath?: string): void {
  const normalizedIssueId = issueId.toUpperCase();
  failedMergeBlocks.delete(`${normalizedIssueId}:${slotIndex}`);
  if (workspacePath) {
    writeSwarmFailedMergeBlock(workspacePath, normalizedIssueId, slotIndex, undefined);
  }
}

export async function recoverFailedMergeSlot(
  issueId: string,
  workspacePath: string,
  slotIndex: number,
  doc: VBriefDocument,
  action: SwarmRecoveryAction,
  deps: Pick<
    CoordinateSwarmSlotsDeps,
    'applyTaskOperationToPlanFile'
    | 'clearSlotAssignment'
    | 'recordSlotAssignment'
    | 'registeredSlotCapacityAvailable'
    | 'tryReserveSwarmSlot'
    | 'releaseSwarmSlot'
    | 'spawnRun'
    | 'shouldDispatch'
    | 'getMaxSlotIndex'
    | 'listSlotAssignments'
    | 'runGitCommand'
  > = defaultDeps,
): Promise<string[]> {
  const normalizedIssueId = issueId.toUpperCase();
  const block = getFailedMergeBlock(normalizedIssueId, slotIndex, workspacePath);
  if (!block) {
    const otherBlocks = getFailedMergeBlocks(normalizedIssueId, workspacePath);
    if (otherBlocks.length === 0) {
      return [`[swarm] no failed-merge slot for ${normalizedIssueId}`];
    }
    const lines = otherBlocks
      .map(b => `  slot ${b.slotIndex} (item ${b.itemId}): ${b.note}`)
      .join('\n');
    return [
      `[swarm] no failed-merge block for ${normalizedIssueId} slot ${slotIndex}. Currently blocked slots:\n${lines}`,
    ];
  }

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
    clearFailedMergeBlock(normalizedIssueId, block.slotIndex, workspacePath);
    deps.clearSlotAssignment(workspacePath, normalizedIssueId, block.slotIndex, block.itemId);
    return [`[swarm] dropped failed-merge slot ${block.slotIndex} (item ${block.itemId}) for ${normalizedIssueId}`];
  }

  // retry: archive the conflicted attempt so it cannot re-assert, then unblock
  // and dispatch a fresh attempt.
  await archiveFailedSwarmSlot(
    normalizedIssueId,
    workspacePath,
    {
      itemId: block.itemId,
      slotIndex: block.slotIndex,
      status: 'in_flight',
      branch: block.branch,
      agentId: block.branch ? `agent-${normalizedIssueId.toLowerCase()}-slot-${block.slotIndex}` : undefined,
    },
    { runGitCommand: deps.runGitCommand, clearSlotAssignment: deps.clearSlotAssignment },
  );
  await deps.applyTaskOperationToPlanFile(planPath, {
    type: 'unblock',
    itemId: block.itemId,
    writerId: 'deacon-swarm',
    reason: 'Retrying failed swarm slot after merge conflict',
  }, workspacePath);
  clearFailedMergeBlock(normalizedIssueId, block.slotIndex, workspacePath);
  const remainingBlocks = getFailedMergeBlocks(normalizedIssueId, workspacePath);
  const blockedSlotIndexes = new Set(remainingBlocks.map(b => b.slotIndex));
  const blockedItemIds = new Set(remainingBlocks.map(b => b.itemId));
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
    }, analyzeSwarmReadiness(retryDoc), deps, blockedSlotIndexes, blockedItemIds),
  ];
}

export function recordStalledSlotRecovery(issueId: string, slots: ClassifiedSwarmSlot[], workspacePath?: string): string[] {
  const actions: string[] = [];
  const normalizedIssueId = issueId.toUpperCase();

  for (const slot of slots.filter(s => s.lifecycle === 'stalled')) {
    if (getFailedMergeBlock(normalizedIssueId, slot.slotIndex, workspacePath)) continue;

    recordFailedMergeBlock({
      issueId: normalizedIssueId,
      itemId: slot.itemId,
      slotIndex: slot.slotIndex,
      branch: slot.branch,
      note: `Slot ${slot.slotIndex} stalled with no branch commit or pane output progress`,
    }, workspacePath);
    actions.push(`[swarm] stalled slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: recovery required`);
  }

  return actions;
}

function writeSwarmFailedMergeBlock(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  block: FailedMergeBlock | undefined,
): void {
  const normalizedIssueId = issueId.toUpperCase();
  const existing = readIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId);
  const record = existing ?? createMinimalIssueRecord(normalizedIssueId);
  const existingSwarm = record.swarm ?? {};
  const existingBlocks = existingSwarm.failedMergeBlocks ?? {};

  // PAN-2364: fold a legacy singular block into the per-slot map and clear the
  // singular field on first write to the new keyed storage.
  const foldedBlocks: Record<string, PanIssueSwarmFailedMergeBlock> = { ...existingBlocks };
  if (existingSwarm.failedMergeBlock) {
    foldedBlocks[String(existingSwarm.failedMergeBlock.slotIndex)] = existingSwarm.failedMergeBlock;
  }

  const nextBlocks = { ...foldedBlocks };
  if (block) {
    nextBlocks[String(slotIndex)] = block;
  } else {
    delete nextBlocks[String(slotIndex)];
  }

  writeIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId, {
    ...record,
    swarm: {
      ...existingSwarm,
      failedMergeBlocks: nextBlocks,
      failedMergeBlock: undefined,
    },
  });
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
    | 'tryReserveSwarmSlot'
    | 'releaseSwarmSlot'
    | 'applyTaskOperationToPlanFile'
    | 'recordSlotAssignment'
    | 'clearSlotAssignment'
    | 'spawnRun'
    | 'shouldDispatch'
    | 'getMaxSlotIndex'
    | 'listSlotAssignments'
  > & Partial<Pick<CoordinateSwarmSlotsDeps, 'listSessionNames' | 'slotWorktreeExists'>> = defaultDeps,
  blockedSlotIndexes: Set<number> = new Set(),
  blockedItemIds: Set<string> = new Set(),
): Promise<string[]> {
  const actions: string[] = [];
  const mergedItemIds = new Set(reconciled.merged.map(slot => slot.itemId));
  const slotEligibleIds = new Set(readiness.items.filter(item => item.slotEligible).map(item => item.id));
  const configuredMaxSlotIndex = Math.max(1, Math.floor((deps.getMaxSlotIndex ?? defaultGetMaxSlotIndex)()));
  const occupiedSlotIndexes = new Set([
    ...blockedSlotIndexes, // PAN-2364: blocked slots count as occupied so other slots cannot collide with them
    ...reconciled.inFlight.map(slot => slot.slotIndex),
    // Local branches hold their index until GC; archived indexes are added below.
    ...reconciled.branches.map(branch => branch.slotIndex),
    ...reconciled.agents.map(agent => agent.slotIndex),
    ...(deps.listSlotAssignments ?? listDurableSlotAssignments)(issueId, workspacePath).map(assignment => assignment.slotIndex),
    ...(reconciled.superseded ?? []).map(attempt => attempt.slotIndex),
  ]);
  const maxSlotIndex = applySupersededSlotHighWater(occupiedSlotIndexes, reconciled, configuredMaxSlotIndex);
  // Orphaned on-disk worktrees still occupy their index (PAN-2213).
  if (deps.slotWorktreeExists) {
    for (let index = 1; index <= maxSlotIndex; index++) {
      if (!occupiedSlotIndexes.has(index) && deps.slotWorktreeExists(`${workspacePath}-slot-${index}`)) {
        occupiedSlotIndexes.add(index);
      }
    }
  }
  const sessionNames = deps.listSessionNames ? await deps.listSessionNames() : [];
  const inFlightItemIds = new Set(reconciled.inFlight.map(slot => slot.itemId));
  const selectedItemIds: string[] = [];
  const planPath = join(workspacePath, '.pan', 'spec.vbrief.json');

  for (const item of getDispatchableItems(doc, mergedItemIds)) {
    if (blockedItemIds.has(item.id)) continue;
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

    let slotIndex: number | null = null;
    for (;;) {
      const candidate = allocateSlotIndex(occupiedSlotIndexes, maxSlotIndex);
      if (candidate === null) break;
      const conflict = slotIndexConflictReason(issueId, workspacePath, candidate, sessionNames, reconciled, deps);
      if (!conflict) {
        slotIndex = candidate;
        break;
      }
      // An index-level conflict the registry missed (live session, unmerged
      // branch, orphaned worktree) means the index is occupied — advance to
      // the next free index instead of refusing the item (PAN-2213).
      occupiedSlotIndexes.add(candidate);
      actions.push(`[swarm] slot ${candidate} occupied for ${issueId}: ${conflict} — advancing`);
    }
    if (slotIndex === null) {
      const occupying = [...occupiedSlotIndexes].filter(index => index >= 1 && index <= maxSlotIndex).sort((a, b) => a - b);
      actions.push(
        `[swarm] deferred ${item.id} for ${issueId}: all slot indexes 1..${maxSlotIndex} are occupied (slots ${occupying.join(', ')})`
        + ` — run \`pan swarm reset ${issueId}\` if these slots are orphans`,
      );
      break;
    }

    if (!deps.tryReserveSwarmSlot()) {
      actions.push(`[swarm] deferred ${item.id} for ${issueId}: swarm dispatch budget exhausted`);
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
      // Freeze/hold can activate mid-wave; the cycle-start gate has already passed
      // by then, so re-check before every spawn (PAN-2214 slot-20 regression).
      if (!(deps.shouldDispatch ?? defaultShouldDispatch)(issueId)) {
        await deps.applyTaskOperationToPlanFile(planPath, {
          type: 'unblock',
          itemId: item.id,
          writerId: 'deacon-swarm',
          reason: 'dispatch halted: freeze/hold active',
        }, workspacePath).catch(() => undefined);
        deps.clearSlotAssignment(workspacePath, issueId, slotIndex, item.id);
        deps.releaseSwarmSlot();
        actions.push(`[swarm] dispatch-halted ${item.id}: freeze/hold active`);
        continue;
      }
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
      deps.releaseSwarmSlot();
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

/** Drop every recorded slot assignment for the issue — used by `pan swarm reset` (PAN-2214). */
export function clearAllSlotAssignments(workspacePath: string, issueId: string): void {
  writeSwarmSlotAssignments(workspacePath, issueId, () => []);
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

function slotIndexConflictReason(
  issueId: string,
  workspacePath: string,
  slotIndex: number,
  sessionNames: readonly string[],
  reconciled: SlotReconcileResult,
  deps: Partial<Pick<CoordinateSwarmSlotsDeps, 'slotWorktreeExists'>>,
): string | undefined {
  const issueLower = issueId.toLowerCase();
  const agentId = `agent-${issueLower}-slot-${slotIndex}`;
  const branch = `feature/${issueLower}-slot-${slotIndex}`;
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

/**
 * Lowest free slot index within the bound, derived purely from the occupied
 * set. Returns null — never an index above the bound — when indexes 1..bound
 * are all occupied (PAN-2214: unbounded allocation climbed slot-5..slot-20).
 */
export function allocateSlotIndex(occupiedSlotIndexes: ReadonlySet<number>, bound: number): number | null {
  const maxIndex = Math.max(1, Math.floor(bound));
  for (let slotIndex = 1; slotIndex <= maxIndex; slotIndex++) {
    if (!occupiedSlotIndexes.has(slotIndex)) return slotIndex;
  }
  return null;
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

/**
 * Whether the issue may register another slot. Counts only tmux-ALIVE slot
 * sessions (stale agents-table rows blocked all dispatch at zero live slots
 * after a reset), capped by the same swarm reserve tryReserveSwarmSlot
 * enforces — never maxWorkAgents (PAN-2214).
 */
export function registeredSlotCapacityAvailable(
  issueId: string,
  selectedCount: number,
  liveSlotCount: number = countRunningSwarmSlotsForIssue(issueId),
  limits: Pick<ConcurrencyLimits, 'reservedSwarmSlots'> = getConcurrencyLimits(),
): boolean {
  return liveSlotCount + selectedCount < limits.reservedSwarmSlots;
}
