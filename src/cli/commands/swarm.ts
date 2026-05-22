/**
 * pan swarm <id> [--dry-run] [--wave N] [--model <model>] [--max-slots N] [--auto-advance]
 * pan swarm recover <issueId> <slotId> --action <retry|drop|handoff> [--yes]
 *
 * Swarm execution: spawn parallel agents across vBRIEF plan items using
 * dependency-wave scheduling.
 *
 * --dry-run: print the wave plan without spawning agents
 * --wave N:  only dispatch wave N (default: next unfinished wave)
 * --model:   override model for work slots (default: config roles.work.model)
 * --max-slots: max concurrent agents (default: respects guardrails)
 * --auto-advance: dispatch next wave automatically when the current wave completes
 * --host: bypass workspace docker stack-health gate after explicit confirmation
 * --yes: confirm --host in non-interactive contexts
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { join } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline/promises';
import { getDashboardApiUrl } from '../../lib/config.js';
import { resolveProjectFromIssue } from '../../lib/projects.js';
import { resolveBareNumericId } from '../../lib/issue-id.js';
import { readWorkspacePlan } from '../../lib/vbrief/io.js';
import { groupItemsByWave, getDispatchableItems, createActiveSlice, verifyActiveSlicePromptReduction, isTaskCommand, type TaskCommand, type Wave } from '../../lib/vbrief/dag.js';
import { runTaskCommand } from '../../lib/vbrief/dag-cli.js';
import { INTERNAL_TOKEN_HEADER, ensureInternalToken } from '../../lib/internal-token.js';
import { normalizeModelOverride } from '../../lib/model-validation.js';

const DASHBOARD_URL = getDashboardApiUrl();

function difficultyColor(d?: string): string {
  switch (d) {
    case 'trivial': return chalk.dim('trivial');
    case 'simple': return chalk.green('simple');
    case 'medium': return chalk.yellow('medium');
    case 'complex': return chalk.red('complex');
    case 'expert': return chalk.magenta('expert');
    default: return chalk.dim('—');
  }
}

function parseFiniteInteger(value: string | undefined, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed)) {
    console.error(chalk.red(`Invalid ${optionName}: ${value}`));
    process.exit(1);
  }
  return parsed;
}

function printWavePlan(waves: Wave[], issueId: string): void {
  const totalItems = waves.reduce((sum, w) => sum + w.items.length, 0);
  console.log(chalk.bold(`\nSwarm plan for ${issueId}: ${totalItems} items across ${waves.length} waves\n`));

  for (const wave of waves) {
    console.log(chalk.cyan.bold(`  Wave ${wave.index}`) + chalk.dim(` (${wave.items.length} items — parallel)`));
    for (const item of wave.items) {
      const deps = item.blockedBy.length > 0
        ? chalk.dim(` ← blocked by: ${item.blockedBy.join(', ')}`)
        : '';
      console.log(`    ${chalk.white(item.id)} ${item.title} ${difficultyColor(item.difficulty)}${deps}`);
    }
    console.log();
  }

  const maxWidth = Math.max(...waves.map(w => w.items.length));
  console.log(chalk.dim(`  Max parallelism: ${maxWidth} agents`));
  console.log(chalk.dim(`  Critical depth: ${waves.length} sequential waves`));
}

interface SwarmCommandOptions {
  dryRun?: boolean;
  wave?: string;
  model?: string;
  maxSlots?: string;
  autoAdvance?: boolean;
  task?: string;
  item?: string;
  reason?: string;
  sequence?: string;
  host?: boolean;
  yes?: boolean;
}

type SwarmRecoverAction = 'retry' | 'drop' | 'handoff';

interface SwarmRecoverCommandOptions {
  action?: string;
  yes?: boolean;
}

const SWARM_RECOVER_ACTIONS = new Set(['retry', 'drop', 'handoff']);

function isSwarmRecoverAction(value: string | undefined): value is SwarmRecoverAction {
  return Boolean(value && SWARM_RECOVER_ACTIONS.has(value));
}

function buildHostOverrideConfirmation(issueId: string): string {
  return `I understand this bypasses workspace isolation for ${issueId.toUpperCase()}`;
}

async function confirmHostOverride(options: SwarmCommandOptions): Promise<boolean> {
  if (!options.host) return true;

  if (!process.stdin.isTTY) {
    if (options.yes) {
      console.warn(chalk.yellow('--host --yes given in a non-interactive context; bypassing workspace isolation.'));
      return true;
    }
    console.error(chalk.red('Error: --host requires an interactive confirmation, or pass --yes for non-interactive use.'));
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(chalk.bold('Are you sure? This bypasses workspace isolation. (y/N) '))).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export function registerSwarmCommands(program: Command): void {
  const swarm = program
    .command('swarm')
    .description('Swarm execution: spawn parallel agents across vBRIEF plan items using dependency-wave scheduling')
    .argument('[id]', 'Issue ID to dispatch')
    .option('--dry-run', 'Print the wave plan without spawning agents')
    .option('--wave <n>', 'Dispatch only wave N')
    .option('--model <model>', 'Override model for work slots (default: config roles.work.model)')
    .option('--max-slots <n>', 'Max concurrent agents')
    .option('--auto-advance', 'Automatically dispatch the next wave when the current one completes')
    .option('--no-auto-advance', 'Disable automatic next-wave dispatching for this swarm')
    .option('--host', 'Bypass workspace docker stack-health gate and spawn swarm slots on the host')
    .option('--yes', 'Confirm --host in non-interactive contexts')
    .option('--task <op>', 'vBRIEF task operation: next | show | claim | done | block | unblock | cancel')
    .option('--item <id>', 'vBRIEF item ID for show/claim/done/block operations')
    .option('--reason <text>', 'Reason for task status mutation')
    .option('--sequence <n>', 'Expected vBRIEF plan.sequence for CAS-protected task mutations')
    .action((id: string | undefined, options: SwarmCommandOptions, command: Command) => {
      if (!id) command.help({ error: true });
      return swarmCommand(id, options);
    });

  swarm
    .command('recover <issueId> <slotId>')
    .description('Recover a failed-merge swarm slot via retry, drop, or handoff')
    .requiredOption('--action <action>', 'Recovery action: retry, drop, or handoff')
    .option('--yes', 'Confirm drop recovery, which marks the vBRIEF item done')
    .action(recoverSwarmCommand);
}

export async function swarmCommand(
  id: string,
  options: SwarmCommandOptions,
): Promise<void> {
  const resolved = resolveBareNumericId(id);
  if (!resolved) {
    console.error(chalk.red(`Could not resolve issue ID "${id}"`));
    console.error(chalk.dim(
      'Pass a fully-qualified ID like "PAN-1148", or ensure the agent state dir exists at ~/.panopticon/agents/agent-<prefix>-<num>/',
    ));
    process.exit(1);
  }
  const issueId = resolved;

  parseFiniteInteger(options.wave, '--wave');
  parseFiniteInteger(options.maxSlots, '--max-slots');
  parseFiniteInteger(options.sequence, '--sequence');
  try {
    const model = normalizeModelOverride(options.model);
    if (model) options.model = model;
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  if (options.task) {
    return taskOperation(issueId, options);
  }

  if (options.dryRun) {
    return dryRun(issueId);
  }

  if (!(await confirmHostOverride(options))) {
    process.exit(1);
  }

  const spinner = ora(`Dispatching swarm for ${issueId}...`).start();

  try {
    const body: Record<string, unknown> = { issueId };
    const wave = parseFiniteInteger(options.wave, '--wave');
    const maxSlots = parseFiniteInteger(options.maxSlots, '--max-slots');
    if (wave !== undefined) body.wave = wave;
    if (options.model) body.model = options.model;
    if (maxSlots !== undefined) body.maxSlots = maxSlots;
    if (options.autoAdvance !== undefined) body.autoAdvance = options.autoAdvance;
    if (options.host) {
      body.host = true;
      body.hostOverrideConfirmation = buildHostOverrideConfirmation(issueId);
    }

    // PAN-977 blocker #3: POST /api/swarm is privileged. Send the internal
    // token so the dashboard auth gate accepts the request.
    const internalToken = ensureInternalToken();
    const response = await fetch(`${DASHBOARD_URL}/api/swarm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: internalToken,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json() as {
      success?: boolean;
      error?: string;
      hint?: string;
      wavePlan?: Wave[];
      dispatched?: number;
      autoAdvance?: boolean;
      slots?: Array<{ slot: number; itemId: string; sessionName: string }>;
    };

    if (!response.ok) {
      spinner.fail(chalk.red(`Failed: ${result.error || 'Unknown error'}`));
      if (result.hint) console.log(chalk.dim(`  ${result.hint}`));
      process.exit(1);
    }

    spinner.succeed(chalk.green(`Swarm dispatched for ${issueId}${result.autoAdvance ? ' (auto-advance on)' : ''}`));

    if (result.wavePlan) {
      printWavePlan(result.wavePlan, issueId);
    }

    if (result.slots && result.slots.length > 0) {
      console.log(chalk.bold(`\nDispatched ${result.dispatched ?? result.slots.length} slot(s):\n`));
      for (const slot of result.slots) {
        console.log(`  ${chalk.cyan(`slot-${slot.slot}`)} → ${slot.itemId} (${chalk.dim(slot.sessionName)})`);
      }
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to reach dashboard: ${error.message}`));
    console.error(chalk.dim(`Make sure the dashboard is running: pan up`));
    process.exit(1);
  }
}

async function confirmDropRecovery(options: SwarmRecoverCommandOptions): Promise<boolean> {
  if (options.action !== 'drop' || options.yes) return true;
  if (!process.stdin.isTTY) {
    console.error(chalk.red('--yes required for non-interactive drop'));
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(chalk.bold('Drop this failed-merge slot and mark its vBRIEF item done? (y/N) '))).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export async function recoverSwarmCommand(
  issueIdInput: string,
  slotIdInput: string,
  options: SwarmRecoverCommandOptions,
): Promise<void> {
  const issueId = resolveBareNumericId(issueIdInput);
  if (!issueId) {
    console.error(chalk.red(`Could not resolve issue ID "${issueIdInput}"`));
    process.exit(1);
  }
  if (!/^[1-9]\d*$/.test(slotIdInput)) {
    console.error(chalk.red(`Invalid slotId: ${slotIdInput}`));
    console.error(chalk.dim('slotId must be a positive integer.'));
    process.exit(1);
  }
  if (!isSwarmRecoverAction(options.action)) {
    console.error(chalk.red(`Invalid --action: ${options.action ?? ''}`));
    console.error(chalk.dim('Valid actions: retry, drop, handoff'));
    process.exit(1);
  }
  if (!(await confirmDropRecovery(options))) {
    process.exit(1);
  }

  const slotId = Number.parseInt(slotIdInput, 10);
  const action = options.action;
  const spinner = ora(`Recovering slot ${slotId} of ${issueId} via ${action}...`).start();
  try {
    const internalToken = ensureInternalToken();
    const response = await fetch(`${DASHBOARD_URL}/api/swarm/${issueId}/slot/${slotId}/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: internalToken,
      },
      body: JSON.stringify({ action }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      spinner.fail(chalk.red(`Failed: ${result.error || 'Unknown error'}`));
      process.exit(1);
    }
    spinner.succeed(chalk.green(`Slot ${slotId} of ${issueId} recovered via ${action}.`));
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to reach dashboard: ${error.message}`));
    console.error(chalk.dim('Make sure the dashboard is running: pan up'));
    process.exit(1);
  }
}

async function dryRun(issueId: string): Promise<void> {
  const project = resolveProjectFromIssue(issueId);
  if (!project) {
    console.error(chalk.red(`Could not resolve project for ${issueId}`));
    process.exit(1);
  }

  const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (!existsSync(workspacePath)) {
    console.error(chalk.red(`No workspace found at ${workspacePath}`));
    process.exit(1);
  }

  const doc = readWorkspacePlan(workspacePath);
  if (!doc) {
    console.error(chalk.red(`No vBRIEF plan found in workspace for ${issueId}`));
    process.exit(1);
  }

  const ready = getDispatchableItems(doc, new Set());
  if (ready.length === 0) {
    console.log(chalk.yellow(`No dispatchable items in the plan for ${issueId}`));
    return;
  }

  console.log(chalk.bold(`\nDispatchable items for ${issueId} (${ready.length})\n`));
  for (const item of ready) {
    console.log(`  ${chalk.white(item.id)} ${item.title} ${difficultyColor(item.metadata?.difficulty)}`);
  }
  console.log(chalk.dim('\nDependency waves (visualization only):'));
  printWavePlan(groupItemsByWave(doc), issueId);
}

async function taskOperation(
  issueId: string,
  options: { task?: string; item?: string; reason?: string; sequence?: string },
): Promise<void> {
  const project = resolveProjectFromIssue(issueId);
  if (!project) {
    console.error(chalk.red(`Could not resolve project for ${issueId}`));
    process.exit(1);
  }
  const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (!options.task || !isTaskCommand(options.task)) {
    console.error(chalk.red(`Invalid --task: ${options.task ?? ''}`));
    console.error(chalk.dim('Supported task operations: next, show, claim, done, block, unblock, cancel'));
    process.exit(1);
  }
  const command: TaskCommand = options.task;
  const result = runTaskCommand(command, {
    issueId,
    workspacePath,
    itemId: options.item,
    expectedSequence: parseFiniteInteger(options.sequence, '--sequence'),
    reason: options.reason,
    writerId: `pan-swarm-task-${process.pid}`,
  });
  if (command === 'next') {
    const items = result as Array<{ id: string; title: string; status: string }>;
    for (const item of items) console.log(`${item.id}\t${item.status}\t${item.title}`);
    return;
  }
  if (command === 'show') {
    const item = result as { id: string; title: string; status: string };
    console.log(JSON.stringify(item, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

export async function printActiveSliceForIssue(issueId: string, itemId?: string): Promise<void> {
  const project = resolveProjectFromIssue(issueId);
  if (!project) throw new Error(`Could not resolve project for ${issueId}`);
  const workspacePath = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const doc = readWorkspacePlan(workspacePath);
  if (!doc) throw new Error(`No vBRIEF plan found in workspace for ${issueId}`);
  const target = itemId ? doc.plan.items.find(i => i.id === itemId) : undefined;
  const item = target ?? doc.plan.items.find(i => i.status !== 'completed' && i.status !== 'cancelled' && i.status !== 'blocked');
  if (!item) throw new Error(`No active item found for ${issueId}`);
  const slice = createActiveSlice(doc, { issueId, itemId: item.id });
  const check = verifyActiveSlicePromptReduction(doc, slice);
  console.log(slice.prompt);
  console.log(chalk.dim(`\nActive slice: ${check.activeSliceBytes} bytes; full plan: ${check.fullPlanBytes} bytes; ratio: ${Math.round(check.reductionRatio * 100)}%`));
}
