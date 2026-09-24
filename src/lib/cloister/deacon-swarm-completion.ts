import { WORKSPACE_RUNTIME_DIRNAME } from '../pan-dir/types.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { messageAgent } from '../agents/messaging.js';
import type { ReconciledSlotItem } from './swarm-slot-reconcile.js';
import { resolveWorkspaceRepoRoots } from '../project-repos.js';
import { loadCloisterConfigSync, type SwarmInferCompletionMode } from './config.js';
import type { ClassifiedSwarmSlot, ClassifyInFlightSlotsOptions, CoordinateSwarmSlotsDeps } from './deacon-swarm.js';
import {
  clearSwarmCompletionObservationRecord,
  readSwarmCompletionObservation,
  writeSwarmCompletionObservation,
} from './deacon-swarm-record.js';

const execAsync = promisify(exec);
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
  deps: Partial<Pick<CoordinateSwarmSlotsDeps,
    | 'getSlotBranchAheadCount'
    | 'isSlotWorktreeClean'
    | 'sendCompletionNudge'
    | 'readCompletionObservation'
    | 'writeCompletionObservation'
    | 'clearCompletionObservation'>>,
  options: ClassifyInFlightSlotsOptions,
  observation: DoneWithoutSignalObservation,
): Promise<ClassifiedSwarmSlot | null> {
  const mode = options.inferCompletion ?? 'off';
  if (mode === 'off' || !slot.agentId || !slot.branch || !options.workspacePath || !options.issueId) {
    if (options.workspacePath && options.issueId) {
      await (deps.clearCompletionObservation ?? clearSwarmCompletionObservationRecord)(
        options.workspacePath,
        options.issueId,
        observation.progressKey,
      );
    }
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
    await (deps.clearCompletionObservation ?? clearSwarmCompletionObservationRecord)(
      options.workspacePath,
      options.issueId,
      observation.progressKey,
    );
    return null;
  }

  const signature = `${observation.commitTime ?? 'none'}:${observation.outputDigest}:${aheadCount}:clean`;
  const previous = (deps.readCompletionObservation ?? readSwarmCompletionObservation)(
    options.workspacePath,
    options.issueId,
    observation.progressKey,
  );
  const current: SlotCompletionObservation = {
    signature,
    nudged: previous?.signature === signature ? previous.nudged : false,
    consecutiveDoneCount: previous?.signature === signature ? previous.consecutiveDoneCount + 1 : 1,
  };
  const actions: string[] = [];
  const normalizedIssueId = options.issueId.toUpperCase();

  if (!current.nudged) {
    if (deps.sendCompletionNudge) await deps.sendCompletionNudge(slot.agentId, normalizedIssueId);
    current.nudged = true;
    actions.push(`[swarm] nudged slot ${slot.slotIndex} (item ${slot.itemId}) for ${normalizedIssueId}: run pan done ${normalizedIssueId}`);
  }

  await (deps.writeCompletionObservation ?? writeSwarmCompletionObservation)(
    options.workspacePath,
    options.issueId,
    observation.progressKey,
    current,
  );
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
  // Completion inference is record-backed; there is no process-local state to reset.
}

export async function clearSwarmCompletionObservation(
  workspacePath: string,
  issueId: string,
  progressKey: string,
  deps: Partial<Pick<CoordinateSwarmSlotsDeps, 'clearCompletionObservation'>>,
): Promise<void> {
  await (deps.clearCompletionObservation ?? clearSwarmCompletionObservationRecord)(workspacePath, issueId, progressKey);
}

export function swarmInferCompletionMode(): SwarmInferCompletionMode {
  const raw = process.env.PAN_SWARM_INFER_COMPLETION ?? loadCloisterConfigSync().swarm?.infer_completion;
  // PAN-2372 WI-5 / FR-8: default to 'auto' (nudge once per stable observation).
  // PAN-3691: 'auto' no longer infers ready-to-merge for a LIVE agent from
  // clean/ahead branch state alone — a live slot converges only through its
  // durable completion signal. Explicit 'nudge' / 'off' in config.yaml or
  // PAN_SWARM_INFER_COMPLETION still parse; 'nudge' and 'auto' now behave the
  // same for live agents.
  return raw === 'off' || raw === 'nudge' || raw === 'auto' ? raw : 'auto';
}

export async function defaultGetSlotBranchAheadCount(
  workspacePath: string,
  issueId: string,
  branch: string,
): Promise<number> {
  const baseBranch = `feature/${issueId.toLowerCase()}`;
  const slotWorkspace = branch.match(/-slot-(\d+)(?:-attempt-\d+)?$/)
    ? `${workspacePath}-slot-${branch.match(/-slot-(\d+)(?:-attempt-\d+)?$/)![1]}`
    : workspacePath;
  const roots = resolveWorkspaceRepoRoots(issueId, slotWorkspace);
  let total = 0;
  for (const root of roots) {
    if (root.degradedPolyrepo) return 0;
    const { stdout } = await execAsync(
      `git rev-list --count ${JSON.stringify(baseBranch)}..${JSON.stringify(branch)}`,
      { cwd: root.dir },
    );
    if (!/^\d+$/.test(stdout.trim())) return 0;
    total += Number(stdout.trim());
  }
  return total;
}

export async function defaultIsSlotWorktreeClean(slotWorkspacePath: string): Promise<boolean> {
  const match = /feature-([a-z]+-\d+)-slot-\d+$/.exec(slotWorkspacePath);
  const roots = match ? resolveWorkspaceRepoRoots(match[1].toUpperCase(), slotWorkspacePath) : [];
  if (roots.some(root => root.degradedPolyrepo)) return false;
  const statuses = roots.length > 0
    ? await Promise.all(roots.map(root => execAsync('git status --porcelain', { cwd: root.dir }).then(result => result.stdout)))
    : [(await execAsync('git status --porcelain', { cwd: slotWorkspacePath })).stdout];
  // PAN-2372 WI-6 / FR-9, re-pointed by PAN-3917: the only dirt that does not
  // block a slot from being inferred complete is the workspace runtime
  // directory, which is machine-local and gitignored. The old exemption also
  // covered `.pan/` writes made by the record door on the state plane; `.pan/`
  // is tracked plan content in the repo now, so a change there is real work and
  // must block, exactly like any other uncommitted file.
  return statuses.every(isRuntimeOnlyPorcelain);
}

/** Every changed path in `git status --porcelain` output. */
function porcelainPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(Boolean)
    .map(line => {
      // Porcelain v1 is two status columns plus a space, then the path. Never
      // trim the leading columns away first: ' M src/foo.ts' would lose its
      // first characters.
      const path = line.slice(3).trim();
      const renamed = path.split(' -> ');
      return (renamed[1] ?? renamed[0] ?? '').replace(/^"|"$/g, '');
    })
    .filter(Boolean);
}

/** True when nothing but the gitignored workspace runtime directory changed. */
function isRuntimeOnlyPorcelain(porcelain: string): boolean {
  return porcelainPaths(porcelain).every(path => path === WORKSPACE_RUNTIME_DIRNAME || path.startsWith(`${WORKSPACE_RUNTIME_DIRNAME}/`));
}

export async function defaultSendCompletionNudge(agentId: string, issueId: string): Promise<void> {
  await messageAgent(
    agentId,
    `You appear to have committed clean slot work but have not signaled completion. If the slot is complete, run exactly:\n\npan done ${issueId}`,
    'deacon:swarm-completion-inference',
  );
}
