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
  coordinateSwarmSlots,
  getFailedMergeBlock,
  recoverFailedMergeSlot,
  type SwarmRecoveryAction,
} from '../../lib/cloister/deacon-swarm.js';
import type { ProjectConfig } from '../../lib/workspace-config.js';
import { getReviewStatusSync, setDeaconIgnored } from '../../lib/review-status.js';
import { appendOperatorInterventionEvent } from '../../lib/operator-interventions.js';

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
  // Single dispatch door (PAN-2214): route through the same full coordination
  // pass the Deacon runs — real slot reconciliation, the statusOverrides
  // merged-plan view, merge, and gc — instead of dispatching against a
  // fabricated empty reconciliation. The old path re-dispatched already
  // completed items (it saw no merged work) and raced live slots.
  const actions = await deps.coordinateSwarmSlots({ issueId: issue });

  if (actions.length === 0) {
    deps.console.log(chalk.yellow(`No swarm slots dispatched for ${issue}.`));
  } else {
    for (const action of actions) deps.console.log(action);
  }
  deps.console.log(chalk.dim('Ongoing swarm coordination will continue in Deacon.'));

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
