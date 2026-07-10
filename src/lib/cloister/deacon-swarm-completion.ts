import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { messageAgent } from '../agents/messaging.js';
import type { ReconciledSlotItem } from '../agents/slot-reconcile.js';
import { isStatePlaneOnlyStatus } from '../state-plane.js';
import { loadCloisterConfigSync, type SwarmInferCompletionMode } from './config.js';
import type { ClassifiedSwarmSlot, ClassifyInFlightSlotsOptions, CoordinateSwarmSlotsDeps } from './deacon-swarm.js';

const execAsync = promisify(exec);
const slotCompletionObservations = new Map<string, SlotCompletionObservation>();

interface SlotCompletionObservation {
  signature: string;
  nudged: boolean;
  consecutiveDoneCount: number;
}

export interface DoneWithoutSignalObservation {
  commitTime: number | null;
  outputDigest: string;
  progressKey: string;
  stalledForMs: number;
}

export async function classifyDoneWithoutSignal(
  slot: ReconciledSlotItem,
  deps: Partial<Pick<CoordinateSwarmSlotsDeps, 'getSlotBranchAheadCount' | 'isSlotWorktreeClean' | 'sendCompletionNudge'>>,
  options: ClassifyInFlightSlotsOptions,
  observation: DoneWithoutSignalObservation,
): Promise<ClassifiedSwarmSlot | null> {
  const mode = options.inferCompletion ?? 'off';
  if (mode === 'off' || !slot.agentId || !slot.branch || !options.workspacePath || !options.issueId) {
    slotCompletionObservations.delete(observation.progressKey);
    return null;
  }

  const aheadCount = await (deps.getSlotBranchAheadCount ?? defaultGetSlotBranchAheadCount)(
    options.workspacePath,
    options.issueId,
    slot.branch,
  ).catch(() => 0);
  const clean = await (deps.isSlotWorktreeClean ?? defaultIsSlotWorktreeClean)(
    `${options.workspacePath}-slot-${slot.slotIndex}`,
  ).catch(() => false);
  if (aheadCount < 1 || !clean) {
    slotCompletionObservations.delete(observation.progressKey);
    return null;
  }

  const signature = `${observation.commitTime ?? 'none'}:${observation.outputDigest}:${aheadCount}:clean`;
  const previous = slotCompletionObservations.get(observation.progressKey);
  const current: SlotCompletionObservation = {
    signature,
    nudged: previous?.signature === signature ? previous.nudged : false,
    consecutiveDoneCount: previous?.signature === signature ? previous.consecutiveDoneCount + 1 : 1,
  };
  const actions: string[] = [];
  const normalizedIssueId = options.issueId.toUpperCase();

  if (!current.nudged) {
    await (deps.sendCompletionNudge ?? defaultSendCompletionNudge)(slot.agentId, normalizedIssueId);
    current.nudged = true;
    actions.push(`[swarm] nudged slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: run pan done ${normalizedIssueId}`);
  }

  slotCompletionObservations.set(observation.progressKey, current);
  if (mode === 'auto' && current.consecutiveDoneCount >= 2) {
    return { ...slot, lifecycle: 'ready-to-merge', exitStatus: 0, signal: 'inferred', actions };
  }

  return {
    ...slot,
    lifecycle: 'awaiting-completion-signal',
    reason: 'no-progress-timeout',
    stalledForMs: observation.stalledForMs,
    signal: 'completion-nudge',
    actions,
  };
}

export async function classifyDurableReadySlot(
  slot: ReconciledSlotItem,
  deps: Partial<Pick<CoordinateSwarmSlotsDeps, 'getSlotBranchAheadCount' | 'isSlotWorktreeClean'>>,
  options: ClassifyInFlightSlotsOptions,
): Promise<ClassifiedSwarmSlot | null> {
  if (!slot.branch || !options.workspacePath || !options.issueId) return null;

  const aheadCount = await (deps.getSlotBranchAheadCount ?? defaultGetSlotBranchAheadCount)(
    options.workspacePath,
    options.issueId,
    slot.branch,
  ).catch(() => 0);
  if (aheadCount < 1) return null;

  const clean = await (deps.isSlotWorktreeClean ?? defaultIsSlotWorktreeClean)(
    `${options.workspacePath}-slot-${slot.slotIndex}`,
  ).catch(() => false);
  if (!clean) return null;

  return { ...slot, lifecycle: 'ready-to-merge', exitStatus: 0, signal: 'inferred' };
}

export function resetSwarmCompletionInferenceForTests(): void {
  slotCompletionObservations.clear();
}

export function clearSwarmCompletionObservation(progressKey: string): void {
  slotCompletionObservations.delete(progressKey);
}

export function swarmInferCompletionMode(): SwarmInferCompletionMode {
  const raw = process.env.PAN_SWARM_INFER_COMPLETION ?? loadCloisterConfigSync().swarm?.infer_completion;
  // PAN-2372 WI-5 / FR-8: default to 'auto' (nudge once, then converge after two stable
  // observations). Explicit 'nudge' / 'off' in config.yaml or PAN_SWARM_INFER_COMPLETION
  // still parse and keep their exact prior semantics.
  return raw === 'off' || raw === 'nudge' || raw === 'auto' ? raw : 'auto';
}

export async function defaultGetSlotBranchAheadCount(
  workspacePath: string,
  issueId: string,
  branch: string,
): Promise<number> {
  const baseBranch = `feature/${issueId.toLowerCase()}`;
  const { stdout } = await execAsync(
    `git rev-list --count ${JSON.stringify(baseBranch)}..${JSON.stringify(branch)}`,
    { cwd: workspacePath },
  );
  const count = Number(stdout.trim());
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export async function defaultIsSlotWorktreeClean(slotWorkspacePath: string): Promise<boolean> {
  const { stdout } = await execAsync('git status --porcelain', { cwd: slotWorkspacePath });
  // PAN-2372 WI-6 / FR-9: treat state-plane-only dirt (.pan/continue.json, .pan/records/...,
  // the workspace record door) as clean. The swarm writes durable state to those paths on the
  // permanent plane, so their presence must not block a slot from being inferred complete.
  // isStatePlaneOnlyStatus already returns true for empty porcelain (vacuous every()), so one
  // shared classifier covers both cases — no local path list here. See docs/STATE-PLANE-COMMIT-POLICY.md.
  return isStatePlaneOnlyStatus(stdout);
}

export async function defaultSendCompletionNudge(agentId: string, issueId: string): Promise<void> {
  await messageAgent(
    agentId,
    `You appear to have committed clean slot work but have not signaled completion. If the slot is complete, run exactly:\n\npan done ${issueId}`,
    'deacon:swarm-completion-inference',
  );
}
