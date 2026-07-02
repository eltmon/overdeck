import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { messageAgent } from '../agents/messaging.js';
import type { ReconciledSlotItem } from '../agents/slot-reconcile.js';
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
    lifecycle: 'stalled',
    reason: 'no-progress-timeout',
    stalledForMs: observation.stalledForMs,
    actions,
  };
}

export function resetSwarmCompletionInferenceForTests(): void {
  slotCompletionObservations.clear();
}

export function clearSwarmCompletionObservation(progressKey: string): void {
  slotCompletionObservations.delete(progressKey);
}

export function swarmInferCompletionMode(): SwarmInferCompletionMode {
  const raw = process.env.PAN_SWARM_INFER_COMPLETION ?? loadCloisterConfigSync().swarm?.infer_completion;
  return raw === 'off' || raw === 'nudge' || raw === 'auto' ? raw : 'nudge';
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
  return stdout.trim().length === 0;
}

export async function defaultSendCompletionNudge(agentId: string, issueId: string): Promise<void> {
  await messageAgent(
    agentId,
    `You appear to have committed clean slot work but have not signaled completion. If the slot is complete, run exactly:\n\npan done ${issueId}`,
    'deacon:swarm-completion-inference',
  );
}
