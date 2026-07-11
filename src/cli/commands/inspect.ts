import { Effect } from 'effect';
/**
 * PAN-382: pan inspect <issueId> --bead <beadId>
 *
 * Triggers the inspect specialist to verify a completed bead
 * matches its specification and architectural constraints.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { resolveBareNumericIdSync } from '../../lib/issue-id.js';
import { spawnInspectAgent, type InspectContext } from '../../lib/cloister/inspect-agent.js';
import { getDiffBase, getDiffStats } from '../../lib/cloister/inspect-checkpoints.js';
import { readWorkspacePlanSync } from '../../lib/vbrief/io.js';

const execFileAsync = promisify(execFile);

interface InspectOptions {
  bead: string;
  workspace?: string;
  deep?: boolean;
}

interface ResolvedInspectBead {
  itemId: string;
  trackerBeadId?: string;
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect <issueId>')
    .description('Request inspection of a completed bead before proceeding to the next')
    .requiredOption('--bead <beadId>', 'Bead ID to inspect')
    .option('--workspace <path>', 'Workspace path (auto-detected if not provided)')
    .option('--deep', 'Use the deep inspection sub-role')
    .action(async (issueId: string, options: InspectOptions) => {
      try {
        await inspectCommand(issueId, options);
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });
}

function itemTitleFromBeadTitle(planId: string, beadTitle: string): string {
  const prefix = `${planId}: `;
  return beadTitle.toLowerCase().startsWith(prefix.toLowerCase())
    ? beadTitle.slice(prefix.length)
    : beadTitle;
}

async function readBdBeadJson(workspacePath: string, beadId: string): Promise<any | null> {
  try {
    const { stdout } = await execFileAsync('bd', ['show', beadId, '--json'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export async function resolveInspectBead(beadId: string, workspacePath: string): Promise<ResolvedInspectBead> {
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) return { itemId: beadId };

  if (doc.plan.items.some(item => item.id === beadId)) {
    return { itemId: beadId };
  }

  const bead = await readBdBeadJson(workspacePath, beadId);
  const metadataItemId = typeof bead?.metadata?.vbriefItemId === 'string'
    ? bead.metadata.vbriefItemId
    : typeof bead?.metadata?.itemId === 'string'
      ? bead.metadata.itemId
      : null;
  if (metadataItemId && doc.plan.items.some(item => item.id === metadataItemId)) {
    return { itemId: metadataItemId, trackerBeadId: beadId };
  }

  if (typeof bead?.title === 'string') {
    const title = itemTitleFromBeadTitle(doc.plan.id, bead.title).toLowerCase();
    const matchingItems = doc.plan.items.filter(item => item.title.toLowerCase() === title);
    if (matchingItems.length === 1) {
      return { itemId: matchingItems[0].id, trackerBeadId: beadId };
    }
  }

  throw new Error(
    `Bead "${beadId}" does not resolve to a readable vBRIEF item in ${workspacePath}. `
    + 'Pass either a vBRIEF item id or a bd bead id whose metadata/title maps to exactly one plan item.',
  );
}

export async function inspectCommand(id: string, options: InspectOptions): Promise<void> {
  const issueId = resolveBareNumericIdSync(id);
  if (!issueId) {
    console.error(chalk.red(`Could not resolve issue ID "${id}"`));
    console.error(chalk.dim(
      'Pass a fully-qualified ID like "PAN-1148", or ensure the agent state dir exists at ~/.overdeck/agents/agent-<prefix>-<num>/',
    ));
    process.exit(1);
  }
  const normalizedIssueId = issueId.toUpperCase();

  // Resolve project from issue ID
  const project = resolveProjectFromIssueSync(normalizedIssueId);
  if (!project) {
    console.error(chalk.red(`Could not resolve project for issue ${normalizedIssueId}`));
    console.error(chalk.dim('Make sure the issue prefix matches a registered project'));
    process.exit(1);
  }

  // Find workspace path
  let workspacePath = options.workspace;
  if (!workspacePath) {
    // Auto-detect workspace from issue ID
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const candidatePath = join(project.projectPath, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`);
    if (existsSync(candidatePath)) {
      workspacePath = candidatePath;
    }
  }

  if (!workspacePath) {
    console.error(chalk.red(`Could not find workspace for ${normalizedIssueId}`));
    console.error(chalk.dim('Provide --workspace <path> or ensure a workspace exists for this issue'));
    process.exit(1);
  }

  const resolvedBead = await resolveInspectBead(options.bead, workspacePath);

  // Show what we're inspecting
  const diffBase = await Effect.runPromise(getDiffBase(project.projectKey, normalizedIssueId, workspacePath));
  const diffStats = await Effect.runPromise(getDiffStats(workspacePath, diffBase));

  console.log('');
  console.log(chalk.bold('Requesting inspection'));
  console.log(chalk.dim(`  Issue:     ${normalizedIssueId}`));
  console.log(chalk.dim(`  Bead:      ${options.bead}`));
  if (resolvedBead.itemId !== options.bead) {
    console.log(chalk.dim(`  vBRIEF:    ${resolvedBead.itemId}`));
  }
  console.log(chalk.dim(`  Depth:     ${options.deep ? 'deep' : 'fast'}`));
  console.log(chalk.dim(`  Workspace: ${workspacePath}`));
  console.log(chalk.dim(`  Diff from: ${diffBase.substring(0, 8)}`));
  console.log('');
  console.log(chalk.dim('Diff scope:'));
  console.log(chalk.dim(diffStats.split('\n').map(l => `  ${l}`).join('\n')));
  console.log('');

  // Spawn the inspect specialist
  const context: InspectContext = {
    projectKey: project.projectKey,
    projectPath: project.projectPath,
    issueId: normalizedIssueId,
    beadId: resolvedBead.itemId,
    trackerBeadId: resolvedBead.trackerBeadId,
    workspace: workspacePath,
    branch: `feature/${normalizedIssueId.toLowerCase()}`,
  };

  const result = await Effect.runPromise(spawnInspectAgent(context, { deep: options.deep === true }));

  if (result.success) {
    if (result.skipped) {
      console.log(chalk.yellow(`Inspect skipped: ${result.message}`));
      return;
    }

    console.log(chalk.green('✓ Inspect specialist spawned'));
    console.log(chalk.dim(`  Session: ${result.tmuxSession}`));
    console.log(chalk.dim(`  Run ID:  ${result.runId}`));
    console.log('');
    console.log(chalk.yellow('The inspect specialist is reviewing your bead.'));
    console.log(chalk.yellow('Wait for the result — it will be delivered to your session via pan tell.'));
  } else {
    console.error(chalk.red(`✗ Failed to spawn inspect specialist: ${result.message}`));
    if (result.error) {
      console.error(chalk.dim(result.error));
    }
    process.exit(1);
  }
}
