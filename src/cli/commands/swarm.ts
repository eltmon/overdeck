import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { getIssueWorkspacePath } from '../../lib/pan-dir/record.js';
import { createWorkspace } from '../../lib/workspace-manager.js';
import { findSpecByIssue } from '../../lib/pan-dir/specs.js';
import { analyzeSwarmReadiness, type SwarmReadinessVerdict } from '../../lib/xbrief/swarm-readiness.js';
import type { XBriefDocument } from '../../lib/xbrief/types.js';
import {
  clearAllSlotAssignments,
  clearFailedMergeBlock,
  coordinateSwarmSlots,
  getFailedMergeBlock,
  getFailedMergeBlocks,
  recoverFailedMergeSlot,
  type SwarmRecoveryAction,
} from '../../lib/cloister/deacon-swarm.js';
import { resolveSwarmPolicy } from '../../lib/swarm-policy.js';
import {
  clearSwarmHold,
  readSwarmHold,
  readSwarmInterventionCount,
  writeSwarmHold,
  writeSwarmIntervention,
  writeSwarmPolicyMode,
} from '../../lib/cloister/deacon-swarm-record.js';
import type { ProjectConfig } from '../../lib/workspace-config.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';
import { listSlotAgents } from '../../lib/agents/slot-reconcile.js';
import { stopAgentSync } from '../../lib/agents.js';
import { listSessionNamesSync } from '../../lib/tmux.js';
import { removeAgent } from '../../lib/agents/removal.js';
import { acknowledgeRecoveryTrip } from '../../lib/cloister/recovery-trip.js';
import { spawnRun } from '../../lib/agents/spawn.js';
import { messageAgent } from '../../lib/agents/messaging.js';
import { buildWorkAgentPrompt } from '../../lib/cloister/work-agent-prompt.js';
import {
  swarmDispatchCommand,
  swarmMergeCommand,
  type SwarmDispatchOptions,
  type SwarmMergeOptions,
} from './swarm-gates.js';
import {
  swarmStatusCommand,
  swarmWaitCommand,
  type SwarmStatusOptions,
  type SwarmWaitOptions,
} from './swarm-status.js';

export {
  swarmDispatchCommand,
  swarmMergeCommand,
  type SwarmDispatchCommandDeps,
  type SwarmDispatchOptions,
  type SwarmMergeCommandDeps,
  type SwarmMergeOptions,
} from './swarm-gates.js';
export {
  deriveSwarmStatus,
  swarmStatusCommand,
  swarmWaitCommand,
  type SwarmStatusCommandDeps,
  type SwarmStatusOptions,
  type SwarmStatusSnapshot,
  type SwarmWaitCommandDeps,
  type SwarmWaitOptions,
} from './swarm-status.js';

const execAsync = promisify(exec);

type ConsoleLike = Pick<typeof console, 'log' | 'error'>;

interface ResolvedProjectLike {
  projectName: string;
  projectPath: string;
}

export interface SwarmCommandDeps {
  resolveProjectFromIssueSync: (issueId: string) => ResolvedProjectLike | null;
  findSpecByIssue: typeof findSpecByIssue;
  analyzeSwarmReadiness: typeof analyzeSwarmReadiness;
  ensureWorkspace: (issueId: string, project: ResolvedProjectLike) => Promise<string>;
  coordinateSwarmSlots: typeof coordinateSwarmSlots;
  getFailedMergeBlock: typeof getFailedMergeBlock;
  getFailedMergeBlocks: typeof getFailedMergeBlocks;
  recoverFailedMergeSlot: typeof recoverFailedMergeSlot;
  resolveSwarmPolicy: typeof resolveSwarmPolicy;
  writeSwarmPolicyMode: typeof writeSwarmPolicyMode;
  readSwarmHold: typeof readSwarmHold;
  readSwarmInterventionCount: typeof readSwarmInterventionCount;
  writeSwarmIntervention: typeof writeSwarmIntervention;
  ensureSwarmForeman: typeof ensureSwarmForeman;
  console: ConsoleLike;
}

export interface SwarmCommandResult {
  ok: boolean;
  actions: string[];
  workspacePath?: string;
}

export interface SwarmRecoverOptions {
  action?: SwarmRecoveryAction;
  operator?: boolean;
}

export interface SwarmFreezeOptions {
  reason?: string;
}

export interface SwarmHoldCommandDeps {
  getIssueWorkspacePath: typeof getIssueWorkspacePath;
  readSwarmHold: typeof readSwarmHold;
  writeSwarmHold: typeof writeSwarmHold;
  clearSwarmHold: typeof clearSwarmHold;
  appendOperatorInterventionEvent: typeof appendOperatorInterventionEvent;
  now: () => string;
  console: ConsoleLike;
}

const defaultHoldDeps: SwarmHoldCommandDeps = {
  getIssueWorkspacePath,
  readSwarmHold,
  writeSwarmHold,
  clearSwarmHold,
  appendOperatorInterventionEvent,
  now: () => new Date().toISOString(),
  console,
};

export interface SwarmStopCommandDeps extends SwarmHoldCommandDeps {
  listSlotAgents: typeof listSlotAgents;
  listSessionNamesSync: () => string[];
  stopAgentSync: (agentId: string) => void;
}

const defaultStopDeps: SwarmStopCommandDeps = {
  ...defaultHoldDeps,
  listSlotAgents,
  listSessionNamesSync,
  stopAgentSync,
};

const defaultDeps: SwarmCommandDeps = {
  resolveProjectFromIssueSync,
  findSpecByIssue,
  analyzeSwarmReadiness,
  ensureWorkspace: ensureFeatureWorkspace,
  coordinateSwarmSlots,
  getFailedMergeBlock,
  getFailedMergeBlocks,
  recoverFailedMergeSlot,
  resolveSwarmPolicy,
  writeSwarmPolicyMode,
  readSwarmHold,
  readSwarmInterventionCount,
  writeSwarmIntervention,
  ensureSwarmForeman,
  console,
};

export async function swarmCommand(
  issueId: string,
  deps: SwarmCommandDeps = defaultDeps,
): Promise<SwarmCommandResult> {
  const issue = issueId.toUpperCase();
  const loaded = await loadSwarmPlan(issue, deps);
  if (!loaded.ok) {
    deps.console.error(chalk.red(loaded.error));
    return { ok: false, actions: [] };
  }

  const readiness = deps.analyzeSwarmReadiness(loaded.doc);
  const ineligibleReasons = swarmIneligibleReasons(readiness);
  if (ineligibleReasons.length > 0) {
    deps.console.error(chalk.red(`${issue} is not swarm eligible:`));
    for (const reason of ineligibleReasons) deps.console.error(`  - ${reason}`);
    return { ok: false, actions: [] };
  }

  const workspacePath = await deps.ensureWorkspace(issue, loaded.project);
  const hold = deps.readSwarmHold(workspacePath, issue);
  if (hold) {
    deps.console.error(chalk.red(swarmHoldMessage(issue, hold.reason)));
    return { ok: false, actions: [], workspacePath };
  }
  // PAN-3459: an explicit start is the issue-level opt-in. Deacon patrols
  // re-resolve the swarm policy with manual=false, so under the default
  // global `swarm.mode: off` they would skip this issue after wave 1 —
  // completed slot branches would never merge and remaining items would
  // never dispatch. Persist the opt-in before coordinating so the promise
  // below ("coordination will continue in Deacon") is actually true.
  const policy = deps.resolveSwarmPolicy(issue);
  if (policy.mode === 'off') {
    await deps.writeSwarmPolicyMode(workspacePath, issue, 'always');
    deps.console.log(chalk.dim(
      `Persisted swarm.policy.mode=always for ${issue} — the effective swarm mode was off (from ${policy.source.mode} config), `
      + 'which would otherwise stop the Deacon from coordinating this swarm after this command.',
    ));
  }
  const actions = await deps.ensureSwarmForeman(issue, workspacePath, { startedBy: 'cli:swarm' });
  for (const action of actions) deps.console.log(action);
  deps.console.log(chalk.dim('The foreman owns dispatch; this command does not dispatch slot work.'));

  return { ok: true, actions, workspacePath };
}

export interface EnsureSwarmForemanDeps {
  listSessionNamesSync: () => string[];
  messageAgent: typeof messageAgent;
  buildWorkAgentPrompt: typeof buildWorkAgentPrompt;
  spawnRun: typeof spawnRun;
  resolveProjectFromIssueSync: typeof resolveProjectFromIssueSync;
}

const defaultForemanDeps: EnsureSwarmForemanDeps = {
  listSessionNamesSync,
  messageAgent,
  buildWorkAgentPrompt,
  spawnRun,
  resolveProjectFromIssueSync,
};

export async function ensureSwarmForeman(
  issueId: string,
  workspacePath: string,
  options: { startedBy: string },
  deps: EnsureSwarmForemanDeps = defaultForemanDeps,
): Promise<string[]> {
  const issue = issueId.toUpperCase();
  const agentId = `agent-${issue.toLowerCase()}`;
  if (deps.listSessionNamesSync().includes(agentId)) {
    await deps.messageAgent(agentId, `Continue managing ${issue} as its swarm foreman. Run pan swarm status ${issue} --json before acting.`, 'pan-swarm');
    return [`[swarm] attached to live foreman ${agentId} for ${issue}`];
  }
  const prompt = await deps.buildWorkAgentPrompt({
    issueId: issue,
    env: 'LOCAL',
    workspacePath,
    projectRoot: deps.resolveProjectFromIssueSync(issue)?.projectPath,
  });
  const state = await deps.spawnRun(issue, 'work', {
    workspace: workspacePath,
    prompt,
    foreman: true,
    startedBy: options.startedBy,
  });
  return [`[swarm] spawned foreman ${state.id} for ${issue}`];
}

export async function swarmRecoverCommand(
  issueId: string,
  slotIndexText: string,
  options: SwarmRecoverOptions = {},
  deps: SwarmCommandDeps = defaultDeps,
): Promise<SwarmCommandResult> {
  const issue = issueId.toUpperCase();
  const slotIndex = Number(slotIndexText);
  if (!Number.isInteger(slotIndex) || slotIndex < 1) {
    deps.console.error(chalk.red(`Invalid slot index: ${slotIndexText}`));
    return { ok: false, actions: [] };
  }

  const action = options.action ?? 'retry';
  if (!isSwarmRecoveryAction(action)) {
    deps.console.error(chalk.red(`Invalid recovery action: ${String(action)}`));
    return { ok: false, actions: [] };
  }

  const loaded = await loadSwarmPlan(issue, deps);
  if (!loaded.ok) {
    deps.console.error(chalk.red(loaded.error));
    return { ok: false, actions: [] };
  }

  const workspacePath = await deps.ensureWorkspace(issue, loaded.project);
  const hold = deps.readSwarmHold(workspacePath, issue);
  if (hold) {
    deps.console.error(chalk.red(swarmHoldMessage(issue, hold.reason)));
    return { ok: false, actions: [], workspacePath };
  }
  const block = deps.getFailedMergeBlock(issue, slotIndex, workspacePath);
  const failureClass = block ? 'failed-merge' : 'slot-failure';
  const interventionCount = deps.readSwarmInterventionCount(workspacePath, issue, slotIndex, failureClass);
  if (interventionCount >= 3 && !options.operator) {
    deps.console.error(chalk.red(
      `Refusing intervention ${interventionCount + 1} for ${issue} slot ${slotIndex} (${failureClass}). `
      + 'The automatic limit is 3 per slot and failure class; pass --operator to override it.',
    ));
    return { ok: false, actions: [], workspacePath };
  }
  const recordedIntervention = await deps.writeSwarmIntervention(
    workspacePath,
    issue,
    slotIndex,
    failureClass,
    { operator: options.operator },
  );
  if (recordedIntervention === null) {
    deps.console.error(chalk.red(
      `Refusing intervention 4 for ${issue} slot ${slotIndex} (${failureClass}). `
      + 'The automatic limit is 3 per slot and failure class; pass --operator to override it.',
    ));
    return { ok: false, actions: [], workspacePath };
  }
  if (!block) {
    if (action === 'retry') {
      const actions = await deps.coordinateSwarmSlots({ issueId: issue });
      const retried = actions.some(line => line.includes(`archived failed slot ${slotIndex} `));
      if (retried) {
        const itemId = actions.find(line => line.includes(`archived failed slot ${slotIndex} `))?.match(/\(item ([^)]+)\)/)?.[1];
        if (itemId) await acknowledgeRecoveryTrip(workspacePath, issue, 'swarm-slot-requeue', itemId).catch(() => undefined);
        for (const line of actions) deps.console.log(line);
        return { ok: true, actions, workspacePath };
      }
    }
    const otherBlocks = deps.getFailedMergeBlocks(issue, workspacePath);
    if (otherBlocks.length > 0) {
      const lines = otherBlocks
        .map(b => `  slot ${b.slotIndex} (item ${b.itemId}): ${b.note}`)
        .join('\n');
      deps.console.error(
        chalk.red(`No failed-merge block for ${issue} slot ${slotIndex}. Currently blocked slots:\n${lines}`),
      );
    } else {
      deps.console.error(chalk.red(`No failed-merge slot is recorded for ${issue}.`));
    }
    return { ok: false, actions: [] };
  }

  const actions = await deps.recoverFailedMergeSlot(issue, workspacePath, slotIndex, loaded.doc, action);
  for (const line of actions) deps.console.log(line);

  return { ok: true, actions, workspacePath };
}

export async function swarmFreezeCommand(
  issueId: string,
  options: SwarmFreezeOptions = {},
  deps: SwarmHoldCommandDeps = defaultHoldDeps,
): Promise<{ ok: boolean }> {
  const issue = issueId.toUpperCase();
  const workspacePath = requireSwarmWorkspace(issue, deps);
  if (!workspacePath) return { ok: false };
  const hold = deps.readSwarmHold(workspacePath, issue);
  if (hold) {
    deps.console.log(chalk.yellow(
      `${issue} is already frozen — the Deacon is already skipping all swarm coordination for it. `
      + `Run \`pan swarm resume ${issue}\` to lift the hold.`,
    ));
    return { ok: true };
  }

  await deps.writeSwarmHold(workspacePath, issue, {
    reason: options.reason ?? 'swarm freeze via pan swarm freeze',
    setBy: 'pan swarm freeze',
    at: deps.now(),
  });
  await deps.appendOperatorInterventionEvent({ issueId: issue, kind: 'pause', source: 'pan swarm freeze' });
  deps.console.log(chalk.green(`Froze swarm coordination for ${issue}.`));
  deps.console.log(
    `The Deacon will now skip all swarm coordination for ${issue} on every patrol — no slot reconciliation, `
    + `no slot merging, no slot garbage collection, and no new slot dispatch will run for this issue until you run `
    + `\`pan swarm resume ${issue}\`. Slot agents that are already running keep running; freeze only stops the `
    + 'Deacon from acting on the issue.',
  );
  return { ok: true };
}

export async function swarmResumeCommand(
  issueId: string,
  deps: SwarmHoldCommandDeps = defaultHoldDeps,
): Promise<{ ok: boolean }> {
  const issue = issueId.toUpperCase();
  const workspacePath = requireSwarmWorkspace(issue, deps);
  if (!workspacePath) return { ok: false };
  const hold = deps.readSwarmHold(workspacePath, issue);
  if (!hold) {
    deps.console.log(chalk.yellow(
      `${issue} is already resumed — no swarm freeze is set, so the Deacon is coordinating it normally.`,
    ));
    return { ok: true };
  }

  await deps.clearSwarmHold(workspacePath, issue);
  await deps.appendOperatorInterventionEvent({ issueId: issue, kind: 'unpause', source: 'pan swarm resume' });
  deps.console.log(chalk.green(`Resumed swarm coordination for ${issue}.`));
  deps.console.log(
    `The freeze on ${issue} is lifted — the Deacon will pick this issue back up on its next patrol cycle and `
    + 'resume slot reconciliation, merging, garbage collection, and dispatch.',
  );
  return { ok: true };
}

export async function swarmStopCommand(
  issueId: string,
  options: SwarmFreezeOptions = {},
  deps: SwarmStopCommandDeps = defaultStopDeps,
): Promise<{ ok: boolean }> {
  const issue = issueId.toUpperCase();
  const issueLower = issue.toLowerCase();

  // Hold FIRST so the Deacon cannot re-spawn slots while they are being stopped
  // (the PAN-1791 incident race: operator removes slots, Deacon re-dispatches them).
  const workspacePath = requireSwarmWorkspace(issue, deps);
  if (!workspacePath) return { ok: false };
  const hold = deps.readSwarmHold(workspacePath, issue);
  if (hold) {
    deps.console.log(chalk.yellow(`${issue} is already frozen — keeping the existing hold in place.`));
  } else {
    await deps.writeSwarmHold(workspacePath, issue, {
      reason: options.reason ?? 'swarm stop via pan swarm stop',
      setBy: 'pan swarm stop',
      at: deps.now(),
    });
  }
  await deps.appendOperatorInterventionEvent({ issueId: issue, kind: 'pause', source: 'pan swarm stop' });

  const slotAgentPattern = new RegExp(`^agent-${escapeRegExp(issueLower)}-slot-\\d+$`);
  const liveAgentIds = new Set<string>();
  for (const sessionName of deps.listSessionNamesSync()) {
    if (slotAgentPattern.test(sessionName)) liveAgentIds.add(sessionName);
  }
  for (const agent of deps.listSlotAgents(issue)) {
    if (agent.status === 'running' || agent.status === 'starting') liveAgentIds.add(agent.agentId);
  }

  if (liveAgentIds.size === 0) {
    deps.console.log(chalk.green(
      `No slot agents are running for ${issue} — nothing to stop. The swarm hold is set, so the Deacon will `
      + `skip all swarm coordination for this issue until you run \`pan swarm resume ${issue}\`.`,
    ));
    return { ok: true };
  }

  let failures = 0;
  for (const agentId of [...liveAgentIds].sort()) {
    try {
      deps.stopAgentSync(agentId);
      deps.console.log(`Stopped slot agent ${agentId}`);
    } catch (error) {
      failures += 1;
      deps.console.error(chalk.red(
        `Failed to stop ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
      ));
    }
  }

  deps.console.log(chalk.green(
    `Swarm stopped for ${issue}: ${liveAgentIds.size - failures} of ${liveAgentIds.size} slot agent(s) stopped.`,
  ));
  deps.console.log(
    'All slot branches and worktrees are preserved — stopping deletes no work. The Deacon will skip all swarm '
    + `coordination for ${issue} until you run \`pan swarm resume ${issue}\` to re-enable it.`,
  );
  return { ok: failures === 0 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireSwarmWorkspace(
  issueId: string,
  deps: Pick<SwarmHoldCommandDeps, 'getIssueWorkspacePath' | 'console'>,
): string | null {
  const workspacePath = deps.getIssueWorkspacePath(issueId);
  if (!workspacePath) deps.console.error(chalk.red(`Could not resolve workspace for ${issueId}.`));
  return workspacePath;
}

export function swarmHoldMessage(issueId: string, reason: string): string {
  return `${issueId} is under a swarm hold (${reason}); run \`pan swarm resume ${issueId}\` before mutating it.`;
}

export interface SwarmResetOptions {
  force?: boolean;
  reason?: string;
}

export interface SwarmResetCommandDeps extends SwarmStopCommandDeps {
  resolveProjectFromIssueSync: (issueId: string) => ResolvedProjectLike | null;
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  clearAllSlotAssignments: typeof clearAllSlotAssignments;
  clearFailedMergeBlock: typeof clearFailedMergeBlock;
  getFailedMergeBlocks: typeof getFailedMergeBlocks;
  removeAgent: (agentId: string) => Promise<unknown>;
}

const defaultResetDeps: SwarmResetCommandDeps = {
  ...defaultStopDeps,
  resolveProjectFromIssueSync,
  runGitCommand: (command, cwd) => execAsync(command, { cwd }),
  clearAllSlotAssignments,
  clearFailedMergeBlock,
  getFailedMergeBlocks,
  removeAgent,
};

/**
 * Work-preserving swarm reset (PAN-2214). Stops the swarm (hold first), pushes
 * every UNMERGED local slot branch to origin BEFORE deleting anything, removes
 * slot worktrees and local slot branches, clears recorded slot assignments and
 * any failed-merge block, and retires dead slot agent records. The
 * hold stays set afterward so the Deacon cannot race the cleanup — the
 * operator re-enables coordination with `pan swarm resume`.
 */
export async function swarmResetCommand(
  issueId: string,
  options: SwarmResetOptions = {},
  deps: SwarmResetCommandDeps = defaultResetDeps,
): Promise<{ ok: boolean }> {
  const issue = issueId.toUpperCase();
  const issueLower = issue.toLowerCase();

  const project = deps.resolveProjectFromIssueSync(issue);
  if (!project) {
    deps.console.error(chalk.red(`Could not resolve project for ${issue}.`));
    return { ok: false };
  }
  const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueLower}`);

  const stopResult = await swarmStopCommand(issue, { reason: options.reason ?? 'swarm reset via pan swarm reset' }, deps);
  if (!stopResult.ok) {
    deps.console.error(chalk.red(
      `Aborting reset for ${issue}: stopping slot agents failed (see above). Nothing was deleted. `
      + 'Stop the failing agents manually, then re-run the reset.',
    ));
    return { ok: false };
  }

  const branches = await listLocalSlotBranches(issue, workspacePath, deps.runGitCommand);
  const unmerged = branches.filter(branch => !branch.merged);

  // Push every unmerged branch BEFORE any deletion — never delete unpushed
  // unmerged work silently.
  const pushed: string[] = [];
  for (const { branch } of unmerged) {
    try {
      await deps.runGitCommand(`git push origin ${JSON.stringify(branch)}`, workspacePath);
      pushed.push(branch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!options.force) {
        deps.console.error(chalk.red(
          `Aborting reset for ${issue}: pushing unmerged branch ${branch} to origin failed (${message}). `
          + 'Nothing was deleted.',
        ));
        deps.console.error(
          `Fix the push (network, auth, remote state) and re-run \`pan swarm reset ${issue}\`, or pass --force `
          + 'to delete the branch even though origin has no backup of it.',
        );
        return { ok: false };
      }
      deps.console.log(chalk.yellow(
        `--force: continuing even though ${branch} could not be pushed to origin (${message}) — its commits `
        + 'will exist only in reflog after deletion.',
      ));
    }
  }

  // Worktrees first (a branch checked out in a worktree cannot be deleted),
  // then local slot branches.
  const worktrees = await listSlotWorktreePaths(workspacePath, deps.runGitCommand);
  for (const worktreePath of worktrees) {
    await deps.runGitCommand(`git worktree remove --force ${JSON.stringify(worktreePath)}`, workspacePath);
  }
  for (const { branch } of branches) {
    await deps.runGitCommand(`git branch -D ${JSON.stringify(branch)}`, workspacePath);
  }

  await deps.clearAllSlotAssignments(workspacePath, issue);
  for (const block of deps.getFailedMergeBlocks(issue, workspacePath)) {
    await deps.clearFailedMergeBlock(issue, block.slotIndex, workspacePath);
  }

  // No stale running registration may survive: mark live-status rows stopped.
  let stoppedRows = 0;
  for (const agent of deps.listSlotAgents(issue)) {
    if (agent.status === 'running' || agent.status === 'starting') {
      try {
        deps.stopAgentSync(agent.agentId);
        stoppedRows += 1;
      } catch (error) {
        deps.console.error(chalk.red(
          `Failed to mark ${agent.agentId} stopped: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    }
  }

  const liveSessions = new Set(deps.listSessionNamesSync());
  const retiredAgents: string[] = [];
  const skippedLiveAgents: string[] = [];
  for (const agent of deps.listSlotAgents(issue)) {
    if (liveSessions.has(agent.agentId)) {
      skippedLiveAgents.push(agent.agentId);
      continue;
    }
    if (agent.status === 'running' || agent.status === 'starting') continue;

    await deps.removeAgent(agent.agentId);
    retiredAgents.push(agent.agentId);
  }

  deps.console.log(chalk.green(`Swarm reset complete for ${issue}.`));
  deps.console.log(
    `Pushed to origin: ${pushed.length > 0 ? pushed.join(', ') : 'nothing (no unmerged slot branches needed a backup)'}. `
    + `Removed ${worktrees.length} slot worktree(s) and ${branches.length} local slot branch(es). `
    + `Cleared the recorded slot assignments and any failed-merge block`
    + `${stoppedRows > 0 ? `, marked ${stoppedRows} lingering slot agent row(s) stopped` : ''}`
    + `${retiredAgents.length > 0 ? `, and retired ${retiredAgents.length} dead slot agent record(s): ${retiredAgents.join(', ')}` : ', and retired no dead slot agent records'}`
    + `${skippedLiveAgents.length > 0 ? `. Skipped live slot agent session(s): ${skippedLiveAgents.join(', ')}` : ''}.`,
  );
  deps.console.log(
    `The swarm hold REMAINS SET — the Deacon still skips all swarm coordination for ${issue}, so nothing can `
    + `re-spawn behind this cleanup. Run \`pan swarm resume ${issue}\` to re-enable coordination `
    + `(then \`pan swarm ${issue}\` to dispatch a fresh wave immediately).`,
  );
  return { ok: true };
}

async function listLocalSlotBranches(
  issueId: string,
  workspacePath: string,
  runGitCommand: SwarmResetCommandDeps['runGitCommand'],
): Promise<Array<{ branch: string; merged: boolean }>> {
  const issueLower = issueId.toLowerCase();
  let names: string[] = [];
  try {
    const result = await runGitCommand(
      `git for-each-ref --format="%(refname:short)" "refs/heads/feature/${issueLower}-slot-*"`,
      workspacePath,
    ) as { stdout?: unknown };
    names = String(result?.stdout ?? '').split('\n').map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }

  const branches: Array<{ branch: string; merged: boolean }> = [];
  for (const branch of names) {
    let merged = false;
    try {
      const result = await runGitCommand(`git rev-list --count HEAD..${JSON.stringify(branch)}`, workspacePath) as { stdout?: unknown };
      const aheadCount = Number(String(result?.stdout ?? '').trim());
      // An unknown ahead-count is treated as unmerged so the branch gets
      // pushed before deletion — the safe direction.
      merged = Number.isFinite(aheadCount) && aheadCount === 0;
    } catch {
      merged = false;
    }
    branches.push({ branch, merged });
  }
  return branches;
}

async function listSlotWorktreePaths(
  workspacePath: string,
  runGitCommand: SwarmResetCommandDeps['runGitCommand'],
): Promise<string[]> {
  try {
    const result = await runGitCommand('git worktree list --porcelain', workspacePath) as { stdout?: unknown };
    const prefix = `worktree ${workspacePath}-slot-`;
    return String(result?.stdout ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith(prefix))
      .map(line => line.slice('worktree '.length));
  } catch {
    return [];
  }
}

export function registerSwarmCommands(program: Command): void {
  const swarm = program
    .command('swarm <id>')
    .description('Start or recover parallel swarm slots for a planned issue')
    .action(async (id: string) => {
      const result = await swarmCommand(id);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('dispatch <id>')
    .description('Run one gated swarm dispatch pass')
    .option('--json', 'Print structured dispatch results')
    .action(async (id: string, options: SwarmDispatchOptions) => {
      const result = await swarmDispatchCommand(id, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('merge <id> <slotIndex>')
    .description('Verify and merge one completed swarm slot')
    .option('--json', 'Print structured merge results')
    .action(async (id: string, slotIndex: string, options: SwarmMergeOptions) => {
      const result = await swarmMergeCommand(id, slotIndex, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('recover <id> <slotIndex>')
    .description('Recover a failed swarm slot')
    .option('--action <action>', 'Recovery action: retry, drop, handoff, or reclaim', 'retry')
    .option('--operator', 'Override the three-intervention limit for this failure class')
    .action(async (id: string, slotIndex: string, options: SwarmRecoverOptions) => {
      const result = await swarmRecoverCommand(id, slotIndex, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('freeze <id>')
    .description('Freeze swarm coordination for an issue: the Deacon skips it until resume')
    .option('--reason <text>', 'Reason recorded on the hold')
    .action(async (id: string, options: SwarmFreezeOptions) => {
      const result = await swarmFreezeCommand(id, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('resume <id>')
    .description('Resume swarm coordination for a frozen issue on the next Deacon patrol')
    .action(async (id: string) => {
      const result = await swarmResumeCommand(id);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('status <id>')
    .description('Read-only reconciled swarm state: per-slot rows, hold state, and capacity')
    .option('--json', 'Print structured status including foreman, hold, and interventions')
    .action(async (id: string, options: SwarmStatusOptions) => {
      const result = await swarmStatusCommand(id, undefined, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('wait <id>')
    .description('Wait for a swarm slot, foreman, or hold state transition')
    .option('--timeout <seconds>', 'Maximum wait in seconds', '300')
    .option('--json', 'Print the structured status delta')
    .action(async (id: string, options: SwarmWaitOptions) => {
      const result = await swarmWaitCommand(id, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('stop <id>')
    .description('Freeze swarm coordination, then stop all live slot agents (branches and worktrees preserved)')
    .option('--reason <text>', 'Reason recorded on the hold')
    .action(async (id: string, options: SwarmFreezeOptions) => {
      const result = await swarmStopCommand(id, options);
      if (!result.ok) process.exitCode = 1;
    });

  swarm
    .command('reset <id>')
    .description('Work-preserving reset: stop slots, push unmerged slot branches to origin, remove slot worktrees/branches, retire dead slot records, clear recorded slot state (hold stays set)')
    .option('--force', 'Continue deleting even when pushing an unmerged branch to origin fails')
    .option('--reason <text>', 'Reason recorded on the hold')
    .action(async (id: string, options: SwarmResetOptions) => {
      const result = await swarmResetCommand(id, options);
      if (!result.ok) process.exitCode = 1;
    });
}

async function ensureFeatureWorkspace(issueId: string, project: ResolvedProjectLike): Promise<string> {
  const featureName = issueId.toLowerCase();
  const workspacePath = join(project.projectPath, 'workspaces', `feature-${featureName}`);
  if (existsSync(workspacePath)) return workspacePath;

  const projectConfig: ProjectConfig = {
    name: project.projectName,
    path: project.projectPath,
  };
  const result = await Effect.runPromise(createWorkspace({
    projectConfig,
    featureName,
    startDocker: false,
  }));
  if (!result.success) {
    throw new Error(`Failed to create workspace for ${issueId}: ${result.errors.join('; ') || 'unknown error'}`);
  }
  return result.workspacePath;
}

async function loadSwarmPlan(
  issueId: string,
  deps: Pick<SwarmCommandDeps, 'resolveProjectFromIssueSync' | 'findSpecByIssue'>,
): Promise<{ ok: true; project: ResolvedProjectLike; doc: XBriefDocument } | { ok: false; error: string }> {
  const project = deps.resolveProjectFromIssueSync(issueId);
  if (!project) return { ok: false, error: `Could not resolve project for ${issueId}.` };

  const spec = await Effect.runPromise(deps.findSpecByIssue(project.projectPath, issueId));
  if (!spec) return { ok: false, error: `No main-side xBRIEF spec found for ${issueId}.` };

  return { ok: true, project, doc: spec.document };
}

function swarmIneligibleReasons(readiness: SwarmReadinessVerdict): string[] {
  const reasons: string[] = [];
  if (!readiness.swarmEligible) {
    reasons.push('no dispatchable item is slot-eligible');
  }

  const slotEligibleCount = readiness.items.filter(item => item.slotEligible).length;
  if (slotEligibleCount < 2) {
    reasons.push(`only ${slotEligibleCount} slot-eligible item${slotEligibleCount === 1 ? '' : 's'} found; swarm dispatch requires at least 2`);
  }

  // Per-item lines explain WHY an ineligible plan cannot dispatch. They are
  // diagnostics, not gates: a plan that passes the aggregate checks above may
  // legitimately contain readiness:'sequential' items (the tri-state contract;
  // e.g. PAN-3092 shipped 6 ready + 1 sequential). The Deacon's dispatch gate
  // (deacon-swarm.ts dispatchEligible) checks only the aggregates — refusing
  // here on any non-eligible item made every mixed plan un-swarmable (PAN-3447).
  if (reasons.length === 0) return reasons;

  for (const item of readiness.items.filter(item => !item.slotEligible)) {
    if (item.missingScope) reasons.push(`${item.id}: missing files_scope`);
    else if (item.scopeConfidence === 'low') reasons.push(`${item.id}: files_scope confidence is low`);
    else if (item.readiness !== 'ready') reasons.push(`${item.id}: readiness is ${item.readiness ?? 'unset'}`);
  }

  return reasons;
}

function isSwarmRecoveryAction(action: unknown): action is SwarmRecoveryAction {
  return action === 'retry' || action === 'drop' || action === 'handoff' || action === 'reclaim';
}

export const __testInternals = {
  ensureFeatureWorkspace,
  swarmIneligibleReasons,
};
