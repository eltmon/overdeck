import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { Command } from 'commander';
import chalk from 'chalk';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { createWorkspace } from '../../lib/workspace-manager.js';
import { findSpecByIssue } from '../../lib/pan-dir/specs.js';
import { analyzeSwarmReadiness, type SwarmReadinessVerdict } from '../../lib/vbrief/swarm-readiness.js';
import type { VBriefDocument } from '../../lib/vbrief/types.js';
import {
  classifyInFlightSlots,
  coordinateSwarmSlots,
  getFailedMergeBlock,
  recoverFailedMergeSlot,
  type ClassifiedSwarmSlot,
  type SwarmRecoveryAction,
} from '../../lib/cloister/deacon-swarm.js';
import { reconcileSlotState } from '../../lib/agents/slot-reconcile.js';
import { countRunningSwarmSlotsForIssue, getConcurrencyLimits } from '../../lib/cloister/concurrency.js';
import type { ProjectConfig } from '../../lib/workspace-config.js';
import { getReviewStatusSync, setDeaconIgnored } from '../../lib/review-status.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';
import { listSlotAgents } from '../../lib/agents/slot-reconcile.js';
import { stopAgentSync } from '../../lib/agents.js';
import { listSessionNamesSync } from '../../lib/tmux.js';

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
  recoverFailedMergeSlot: typeof recoverFailedMergeSlot;
  console: ConsoleLike;
}

export interface SwarmCommandResult {
  ok: boolean;
  actions: string[];
  workspacePath?: string;
}

export interface SwarmRecoverOptions {
  action?: SwarmRecoveryAction;
}

export interface SwarmFreezeOptions {
  reason?: string;
}

export interface SwarmHoldCommandDeps {
  getReviewStatusSync: typeof getReviewStatusSync;
  setDeaconIgnored: typeof setDeaconIgnored;
  appendOperatorInterventionEvent: typeof appendOperatorInterventionEvent;
  console: ConsoleLike;
}

const defaultHoldDeps: SwarmHoldCommandDeps = {
  getReviewStatusSync,
  setDeaconIgnored,
  appendOperatorInterventionEvent,
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
  recoverFailedMergeSlot,
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
  // Manual dispatch runs the IDENTICAL reconcile → classify → merge → gc →
  // dispatch pipeline the Deacon patrol runs — including the operator-hold
  // skip, advance backoff, failed-merge block, duplicate guards, bounded
  // allocation, and the per-spawn freeze gate. The old path called
  // dispatchNextWave with an EMPTY reconcile result and raced the Deacon
  // (PAN-2214). Re-running the command is idempotent: already-dispatched
  // work is reconciled, not re-spawned.
  const actions = await deps.coordinateSwarmSlots({ issueId: issue });

  if (actions.length === 0) {
    deps.console.log(chalk.yellow(`No swarm slots dispatched for ${issue}.`));
  } else {
    for (const action of actions) deps.console.log(action);
  }

  const holdSkip = actions.find(action => action.includes('operator hold'));
  if (holdSkip) {
    deps.console.log(chalk.yellow(
      `${issue} is under an operator hold, so the coordinator skipped it and dispatched nothing. `
      + `Run \`pan swarm resume ${issue}\` to lift the hold and re-enable swarm coordination.`,
    ));
  } else {
    deps.console.log(chalk.dim('Ongoing swarm coordination will continue in Deacon.'));
  }

  return { ok: true, actions, workspacePath };
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
  const block = deps.getFailedMergeBlock(issue, workspacePath);
  if (!block) {
    deps.console.error(chalk.red(`No failed-merge slot is recorded for ${issue}.`));
    return { ok: false, actions: [] };
  }
  if (block.slotIndex !== slotIndex) {
    deps.console.error(chalk.red(`Recorded failed-merge slot for ${issue} is slot ${block.slotIndex}, not slot ${slotIndex}.`));
    return { ok: false, actions: [] };
  }

  const actions = await deps.recoverFailedMergeSlot(issue, workspacePath, loaded.doc, action);
  for (const line of actions) deps.console.log(line);

  return { ok: true, actions, workspacePath };
}

export async function swarmFreezeCommand(
  issueId: string,
  options: SwarmFreezeOptions = {},
  deps: SwarmHoldCommandDeps = defaultHoldDeps,
): Promise<{ ok: boolean }> {
  const issue = issueId.toUpperCase();
  const status = safeGetReviewStatus(issue, deps);
  if (status?.deaconIgnored) {
    deps.console.log(chalk.yellow(
      `${issue} is already frozen — the Deacon is already skipping all swarm coordination for it. `
      + `Run \`pan swarm resume ${issue}\` to lift the hold.`,
    ));
    return { ok: true };
  }

  deps.setDeaconIgnored(issue, true, options.reason ?? 'swarm freeze via pan swarm freeze');
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
  const status = safeGetReviewStatus(issue, deps);
  if (!status?.deaconIgnored) {
    deps.console.log(chalk.yellow(
      `${issue} is already resumed — no swarm freeze is set, so the Deacon is coordinating it normally.`,
    ));
    return { ok: true };
  }

  deps.setDeaconIgnored(issue, false);
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
  const status = safeGetReviewStatus(issue, deps);
  if (status?.deaconIgnored) {
    deps.console.log(chalk.yellow(`${issue} is already frozen — keeping the existing hold in place.`));
  } else {
    deps.setDeaconIgnored(issue, true, options.reason ?? 'swarm stop via pan swarm stop');
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

function safeGetReviewStatus(
  issueId: string,
  deps: Pick<SwarmHoldCommandDeps, 'getReviewStatusSync'>,
): ReturnType<typeof getReviewStatusSync> {
  try {
    return deps.getReviewStatusSync(issueId);
  } catch {
    return null;
  }
}

export interface SwarmStatusCommandDeps {
  resolveProjectFromIssueSync: (issueId: string) => ResolvedProjectLike | null;
  findSpecByIssue: typeof findSpecByIssue;
  reconcileSlotState: typeof reconcileSlotState;
  classifyInFlightSlots: (
    slots: Parameters<typeof classifyInFlightSlots>[0],
    workspacePath: string,
  ) => Promise<ClassifiedSwarmSlot[]>;
  getReviewStatusSync: typeof getReviewStatusSync;
  listSessionNamesSync: () => string[];
  getConcurrencyLimits: typeof getConcurrencyLimits;
  countRunningSwarmSlotsForIssue: (issueId: string) => number;
  console: ConsoleLike;
}

const defaultStatusDeps: SwarmStatusCommandDeps = {
  resolveProjectFromIssueSync,
  findSpecByIssue,
  reconcileSlotState,
  classifyInFlightSlots: (slots, workspacePath) => classifyInFlightSlots(slots, undefined, { workspacePath }),
  getReviewStatusSync,
  listSessionNamesSync,
  getConcurrencyLimits,
  countRunningSwarmSlotsForIssue,
  console,
};

/**
 * Read-only reconciled view of an issue's swarm: per-slot rows, the operator
 * hold state, and slot capacity. Performs no writes, no git mutation, and no
 * dispatch (PAN-2214).
 */
export async function swarmStatusCommand(
  issueId: string,
  deps: SwarmStatusCommandDeps = defaultStatusDeps,
): Promise<{ ok: boolean }> {
  const issue = issueId.toUpperCase();
  const issueLower = issue.toLowerCase();
  const loaded = await loadSwarmPlan(issue, deps);
  if (!loaded.ok) {
    deps.console.error(chalk.red(loaded.error));
    return { ok: false };
  }

  const workspacePath = join(loaded.project.projectPath, 'workspaces', `feature-${issueLower}`);
  const reconciled = await deps.reconcileSlotState(issue, workspacePath, loaded.doc);
  const classified = await deps.classifyInFlightSlots(reconciled.inFlight, workspacePath);
  const lifecycleBySlot = new Map(classified.map(slot => [slot.slotIndex, slot.lifecycle]));
  const branchMergedBySlot = new Map(reconciled.branches.map(branch => [branch.slotIndex, branch.merged]));
  const liveSessions = new Set(safeListSessionNames(deps));

  deps.console.log(chalk.bold(`Swarm status for ${issue}`));

  const hold = safeGetReviewStatus(issue, deps);
  if (hold?.deaconIgnored) {
    const reason = hold.deaconIgnoredReason ? ` Reason: ${hold.deaconIgnoredReason}.` : '';
    deps.console.log(
      `Hold: deacon-ignored — the Deacon skips all swarm coordination (reconcile, merge, garbage collection, `
      + `and dispatch) for this issue until you run \`pan swarm resume ${issue}\`.${reason}`,
    );
  } else if (hold?.stuck) {
    const reason = hold.stuckReason ? ` Reason: ${hold.stuckReason}.` : '';
    deps.console.log(
      `Hold: stuck — the issue is flagged stuck, so the Deacon skips all swarm coordination for it until the `
      + `flag is cleared.${reason}`,
    );
  } else {
    deps.console.log('Hold: none — the Deacon is actively coordinating this issue on every patrol.');
  }

  const limits = deps.getConcurrencyLimits();
  const liveSlotCount = deps.countRunningSwarmSlotsForIssue(issue);
  deps.console.log(
    `Capacity: ${liveSlotCount} of ${limits.reservedSwarmSlots} swarm slots in use `
    + '(tmux-alive slot sessions counted against the reserved swarm slot limit).',
  );

  const rows = [
    ...reconciled.merged.map(slot => ({ ...slot, lifecycle: 'merged' })),
    ...reconciled.inFlight.map(slot => ({ ...slot, lifecycle: lifecycleBySlot.get(slot.slotIndex) ?? 'running' })),
  ].sort((a, b) => a.slotIndex - b.slotIndex);

  if (rows.length === 0) {
    deps.console.log('Slots: none — nothing is dispatched right now, and no merged slot state remains.');
    return { ok: true };
  }

  deps.console.log('Slots:');
  for (const row of rows) {
    const branch = row.branch ?? `feature/${issueLower}-slot-${row.slotIndex}`;
    const branchState = branchMergedBySlot.get(row.slotIndex) === undefined
      ? 'no local branch'
      : branchMergedBySlot.get(row.slotIndex) ? 'merged' : 'unmerged';
    const sessionName = row.agentId ?? `agent-${issueLower}-slot-${row.slotIndex}`;
    const sessionState = liveSessions.has(sessionName) ? 'session alive' : 'session dead';
    deps.console.log(
      `  slot ${row.slotIndex} · item ${row.itemId} · ${row.lifecycle} · branch ${branch} (${branchState}) · ${sessionState}`,
    );
  }
  return { ok: true };
}

function safeListSessionNames(deps: Pick<SwarmStatusCommandDeps, 'listSessionNamesSync'>): string[] {
  try {
    return deps.listSessionNamesSync();
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
    .command('recover <id> <slotIndex>')
    .description('Recover a failed swarm slot')
    .option('--action <action>', 'Recovery action: retry, drop, or handoff', 'retry')
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
    .action(async (id: string) => {
      const result = await swarmStatusCommand(id);
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
): Promise<{ ok: true; project: ResolvedProjectLike; doc: VBriefDocument } | { ok: false; error: string }> {
  const project = deps.resolveProjectFromIssueSync(issueId);
  if (!project) return { ok: false, error: `Could not resolve project for ${issueId}.` };

  const spec = await Effect.runPromise(deps.findSpecByIssue(project.projectPath, issueId));
  if (!spec) return { ok: false, error: `No main-side vBRIEF spec found for ${issueId}.` };

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

  for (const item of readiness.items.filter(item => !item.slotEligible)) {
    if (item.missingScope) reasons.push(`${item.id}: missing files_scope`);
    else if (item.scopeConfidence === 'low') reasons.push(`${item.id}: files_scope confidence is low`);
    else if (item.readiness !== 'ready') reasons.push(`${item.id}: readiness is ${item.readiness ?? 'unset'}`);
  }

  return reasons;
}

function isSwarmRecoveryAction(action: unknown): action is SwarmRecoveryAction {
  return action === 'retry' || action === 'drop' || action === 'handoff';
}

export const __testInternals = {
  ensureFeatureWorkspace,
  swarmIneligibleReasons,
};
