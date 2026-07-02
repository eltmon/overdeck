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
