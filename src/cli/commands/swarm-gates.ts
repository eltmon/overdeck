import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { Effect } from 'effect';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { findSpecByIssue } from '../../lib/pan-dir/specs.js';
import { createWorkspace } from '../../lib/workspace-manager.js';
import type { ProjectConfig } from '../../lib/workspace-config.js';
import type { XBriefDocument } from '../../lib/xbrief/types.js';
import { analyzeSwarmReadiness } from '../../lib/xbrief/swarm-readiness.js';
import { applyStatusOverrides } from '../../lib/xbrief/io.js';
import { readIssueRecordForWorkspaceSync } from '../../lib/pan-dir/record.js';
import { readSwarmHold } from '../../lib/cloister/deacon-swarm-record.js';
import {
  classifyInFlightSlots,
  dispatchNextWave,
  getFailedMergeBlock,
  getFailedMergeBlocks,
  mergeReadySlots,
  type ClassifiedSwarmSlot,
} from '../../lib/cloister/deacon-swarm.js';
import { reconcileSlotState } from '../../lib/agents/slot-reconcile.js';

type ConsoleLike = Pick<typeof console, 'log' | 'error'>;

interface ResolvedProjectLike {
  projectName: string;
  projectPath: string;
}

export interface SwarmGateResult {
  ok: boolean;
  actions: string[];
  workspacePath?: string;
}

interface SwarmGateDeps {
  resolveProjectFromIssueSync: (issueId: string) => ResolvedProjectLike | null;
  findSpecByIssue: typeof findSpecByIssue;
  ensureWorkspace: (issueId: string, project: ResolvedProjectLike) => Promise<string>;
  analyzeSwarmReadiness: typeof analyzeSwarmReadiness;
  readSwarmHold: typeof readSwarmHold;
  reconcileSlotState: typeof reconcileSlotState;
  getFailedMergeBlocks: typeof getFailedMergeBlocks;
  console: ConsoleLike;
}

export interface SwarmDispatchOptions {
  json?: boolean;
}

export interface SwarmDispatchCommandDeps extends SwarmGateDeps {
  dispatchNextWave: typeof dispatchNextWave;
}

export interface SwarmMergeOptions {
  json?: boolean;
}

export interface SwarmMergeCommandDeps extends SwarmGateDeps {
  classifyInFlightSlots: (
    slots: Parameters<typeof classifyInFlightSlots>[0],
    workspacePath: string,
    issueId: string,
  ) => Promise<ClassifiedSwarmSlot[]>;
  getFailedMergeBlock: typeof getFailedMergeBlock;
  mergeReadySlots: typeof mergeReadySlots;
}

const baseDeps: SwarmGateDeps = {
  resolveProjectFromIssueSync,
  findSpecByIssue,
  ensureWorkspace: ensureFeatureWorkspace,
  analyzeSwarmReadiness,
  readSwarmHold,
  reconcileSlotState,
  getFailedMergeBlocks,
  console,
};

const defaultDispatchDeps: SwarmDispatchCommandDeps = {
  ...baseDeps,
  dispatchNextWave,
};

const defaultMergeDeps: SwarmMergeCommandDeps = {
  ...baseDeps,
  classifyInFlightSlots: (slots, workspacePath, issueId) => classifyInFlightSlots(slots, undefined, {
    workspacePath,
    issueId,
  }),
  getFailedMergeBlock,
  mergeReadySlots,
};

export async function swarmDispatchCommand(
  issueId: string,
  options: SwarmDispatchOptions = {},
  deps: SwarmDispatchCommandDeps = defaultDispatchDeps,
): Promise<SwarmGateResult> {
  const issue = issueId.toUpperCase();
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

  const overrides = readIssueRecordForWorkspaceSync(workspacePath, issue)?.statusOverrides;
  const doc = overrides && Object.keys(overrides).length > 0
    ? applyStatusOverrides(loaded.doc, overrides)
    : loaded.doc;
  const readiness = deps.analyzeSwarmReadiness(doc);
  const reconciled = await deps.reconcileSlotState(issue, workspacePath, doc);
  const failedMergeBlocks = deps.getFailedMergeBlocks(issue, workspacePath);
  const actions = await deps.dispatchNextWave(
    issue,
    workspacePath,
    doc,
    reconciled,
    readiness,
    undefined,
    new Set(failedMergeBlocks.map(block => block.slotIndex)),
    new Set(failedMergeBlocks.map(block => block.itemId)),
  );

  if (options.json) deps.console.log(JSON.stringify({ issueId: issue, actions }));
  else if (actions.length === 0) deps.console.log(chalk.yellow(`No swarm slots dispatched for ${issue}.`));
  else for (const action of actions) deps.console.log(action);
  return { ok: true, actions, workspacePath };
}

export async function swarmMergeCommand(
  issueId: string,
  slotIndexText: string,
  options: SwarmMergeOptions = {},
  deps: SwarmMergeCommandDeps = defaultMergeDeps,
): Promise<SwarmGateResult> {
  const issue = issueId.toUpperCase();
  const slotIndex = Number(slotIndexText);
  if (!Number.isInteger(slotIndex) || slotIndex < 1) {
    deps.console.error(chalk.red(`Invalid slot index: ${slotIndexText}`));
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

  const overrides = readIssueRecordForWorkspaceSync(workspacePath, issue)?.statusOverrides;
  const doc = overrides && Object.keys(overrides).length > 0
    ? applyStatusOverrides(loaded.doc, overrides)
    : loaded.doc;
  const reconciled = await deps.reconcileSlotState(issue, workspacePath, doc, { statusOverrides: overrides });
  const slot = reconciled.inFlight.find(candidate => candidate.slotIndex === slotIndex);
  if (!slot) {
    deps.console.error(chalk.red(`No in-flight swarm slot ${slotIndex} exists for ${issue}.`));
    return { ok: false, actions: [], workspacePath };
  }
  const classified = await deps.classifyInFlightSlots([slot], workspacePath, issue);
  const candidate = classified[0];
  if (!candidate || candidate.lifecycle !== 'ready-to-merge') {
    const lifecycle = candidate?.lifecycle ?? 'unknown';
    deps.console.error(chalk.red(
      `Refusing to merge ${issue} slot ${slotIndex}: lifecycle is ${lifecycle}. `
      + 'A live slot needs a durable completion signal before merge.',
    ));
    return { ok: false, actions: [], workspacePath };
  }

  const blocked = deps.getFailedMergeBlock(issue, slotIndex, workspacePath) ? new Set([slotIndex]) : new Set<number>();
  const actions = await deps.mergeReadySlots(issue, workspacePath, doc, [candidate], undefined, blocked);
  const ok = !actions.some(action => action.includes('failed-merge') || action.includes('verify-failed'));
  if (options.json) deps.console.log(JSON.stringify({ issueId: issue, slotIndex, ok, actions }));
  else for (const action of actions) deps.console.log(action);
  return { ok, actions, workspacePath };
}

async function ensureFeatureWorkspace(issueId: string, project: ResolvedProjectLike): Promise<string> {
  const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (existsSync(workspacePath)) return workspacePath;
  const projectConfig: ProjectConfig = { name: project.projectName, path: project.projectPath };
  const result = await Effect.runPromise(createWorkspace({
    projectConfig,
    featureName: issueId.toLowerCase(),
    startDocker: false,
  }));
  if (!result.success) {
    throw new Error(`Failed to create workspace for ${issueId}: ${result.errors.join('; ') || 'unknown error'}`);
  }
  return result.workspacePath;
}

async function loadSwarmPlan(
  issueId: string,
  deps: Pick<SwarmGateDeps, 'resolveProjectFromIssueSync' | 'findSpecByIssue'>,
): Promise<{ ok: true; project: ResolvedProjectLike; doc: XBriefDocument } | { ok: false; error: string }> {
  const project = deps.resolveProjectFromIssueSync(issueId);
  if (!project) return { ok: false, error: `Could not resolve project for ${issueId}.` };
  const spec = await Effect.runPromise(deps.findSpecByIssue(project.projectPath, issueId));
  if (!spec) return { ok: false, error: `No main-side xBRIEF spec found for ${issueId}.` };
  return { ok: true, project, doc: spec.document };
}

function swarmHoldMessage(issueId: string, reason?: string): string {
  const detail = reason ? ` Reason: ${reason}.` : '';
  return `${issueId} is frozen. Run \`pan swarm resume ${issueId}\` before dispatching or merging.${detail}`;
}
