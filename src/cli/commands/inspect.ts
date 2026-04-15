/**
 * PAN-382: pan inspect <issueId> --bead <beadId>
 *
 * Triggers the inspect specialist to verify a completed bead
 * matches its specification and architectural constraints.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolveProjectFromIssue } from '../../lib/projects.js';
import { spawnInspectAgent, type InspectContext } from '../../lib/cloister/inspect-agent.js';
import { getDiffBase, getDiffStats } from '../../lib/cloister/inspect-checkpoints.js';

interface InspectOptions {
  bead: string;
  workspace?: string;
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect <issueId>')
    .description('Request inspection of a completed bead before proceeding to the next')
    .requiredOption('--bead <beadId>', 'Bead ID to inspect')
    .option('--workspace <path>', 'Workspace path (auto-detected if not provided)')
    .action(async (issueId: string, options: InspectOptions) => {
      try {
        await inspectCommand(issueId, options);
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
    });
}

async function inspectCommand(issueId: string, options: InspectOptions): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();

  // Resolve project from issue ID
  const project = resolveProjectFromIssue(normalizedIssueId);
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

  // Show what we're inspecting
  const diffBase = await getDiffBase(project.projectKey, normalizedIssueId, workspacePath);
  const diffStats = await getDiffStats(workspacePath, diffBase);

  console.log('');
  console.log(chalk.bold('Requesting inspection'));
  console.log(chalk.dim(`  Issue:     ${normalizedIssueId}`));
  console.log(chalk.dim(`  Bead:      ${options.bead}`));
  console.log(chalk.dim(`  Workspace: ${workspacePath}`));
  console.log(chalk.dim(`  Diff from: ${diffBase.substring(0, 8)}`));
  console.log('');
  console.log(chalk.dim('Diff scope:'));
  console.log(chalk.dim(diffStats.split('\n').map(l => `  ${l}`).join('\n')));
  console.log('');

  // Detect flywheel-change from STATE.md (written by auto-finalize)
  const { join: pathJoin } = await import('path');
  const { existsSync: fsExistsSync, readFileSync: fsReadFileSync } = await import('fs');
  let isFlywheelChange = false;
  try {
    const stateMdPath = pathJoin(workspacePath, '.planning', 'STATE.md');
    if (fsExistsSync(stateMdPath)) {
      const stateContent = fsReadFileSync(stateMdPath, 'utf-8');
      isFlywheelChange = stateContent.includes('flywheel-change');
    }
  } catch { /* Non-fatal — proceed without flywheel-change context */ }

  // Spawn the inspect specialist
  const context: InspectContext = {
    projectKey: project.projectKey,
    projectPath: project.projectPath,
    issueId: normalizedIssueId,
    beadId: options.bead,
    workspace: workspacePath,
    branch: `feature/${normalizedIssueId.toLowerCase()}`,
    isFlywheelChange,
  };

  const result = await spawnInspectAgent(context);

  if (result.success) {
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
