/**
 * pan swarm <id> [--dry-run] [--wave N] [--model <model>] [--max-slots N] [--auto-advance]
 *
 * Swarm execution: spawn parallel agents across vBRIEF plan items using
 * dependency-wave scheduling.
 *
 * --dry-run: print the wave plan without spawning agents
 * --wave N:  only dispatch wave N (default: next unfinished wave)
 * --model:   override model for work slots (default: kimi-k2.6)
 * --max-slots: max concurrent agents (default: respects guardrails)
 * --auto-advance: dispatch next wave automatically when the current wave completes
 */

import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { existsSync } from 'fs';
import { getDashboardApiUrl } from '../../lib/config.js';
import { resolveProjectFromIssue } from '../../lib/projects.js';
import { readWorkspacePlan } from '../../lib/vbrief/io.js';
import { groupItemsByWave, getDispatchableItems, runTaskCommand, createActiveSlice, verifyActiveSlicePromptReduction, isTaskCommand, type TaskCommand, type Wave } from '../../lib/vbrief/dag.js';
import { INTERNAL_TOKEN_HEADER, ensureInternalToken } from '../../lib/internal-token.js';

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

export async function swarmCommand(
  id: string,
  options: { dryRun?: boolean; wave?: string; model?: string; maxSlots?: string; autoAdvance?: boolean; task?: string; item?: string; reason?: string; sequence?: string },
): Promise<void> {
  const issueId = id.toUpperCase();

  parseFiniteInteger(options.wave, '--wave');
  parseFiniteInteger(options.maxSlots, '--max-slots');
  parseFiniteInteger(options.sequence, '--sequence');

  if (options.task) {
    return taskOperation(issueId, options);
  }

  if (options.dryRun) {
    return dryRun(issueId);
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
