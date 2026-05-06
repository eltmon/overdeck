/**
 * pan swarm <id> [--dry-run] [--wave N] [--model <model>] [--max-slots N]
 *
 * Swarm execution: spawn parallel agents across vBRIEF plan items using
 * dependency-wave scheduling.
 *
 * --dry-run: print the wave plan without spawning agents
 * --wave N:  only dispatch wave N (default: next unfinished wave)
 * --model:   override model for work slots (default: kimi-k2.6)
 * --max-slots: max concurrent agents (default: respects guardrails)
 */

import chalk from 'chalk';
import ora from 'ora';
import { join } from 'path';
import { existsSync } from 'fs';
import { getDashboardApiUrl } from '../../lib/config.js';
import { resolveProjectFromIssue } from '../../lib/projects.js';
import { readWorkspacePlan } from '../../lib/vbrief/io.js';
import { groupItemsByWave, type Wave } from '../../lib/vbrief/dag.js';

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
  options: { dryRun?: boolean; wave?: string; model?: string; maxSlots?: string },
): Promise<void> {
  const issueId = id.toUpperCase();

  if (options.dryRun) {
    return dryRun(issueId);
  }

  const spinner = ora(`Dispatching swarm for ${issueId}...`).start();

  try {
    const body: Record<string, unknown> = { issueId };
    if (options.wave !== undefined) body.wave = parseInt(options.wave, 10);
    if (options.model) body.model = options.model;
    if (options.maxSlots) body.maxSlots = parseInt(options.maxSlots, 10);

    const response = await fetch(`${DASHBOARD_URL}/api/swarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json() as {
      success?: boolean;
      error?: string;
      hint?: string;
      wavePlan?: Wave[];
      dispatched?: number;
      slots?: Array<{ slot: number; itemId: string; sessionName: string }>;
    };

    if (!response.ok) {
      spinner.fail(chalk.red(`Failed: ${result.error || 'Unknown error'}`));
      if (result.hint) console.log(chalk.dim(`  ${result.hint}`));
      process.exit(1);
    }

    spinner.succeed(chalk.green(`Swarm dispatched for ${issueId}`));

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

  const waves = groupItemsByWave(doc);
  if (waves.length === 0) {
    console.log(chalk.yellow(`No actionable items in the plan for ${issueId}`));
    return;
  }

  printWavePlan(waves, issueId);
}
