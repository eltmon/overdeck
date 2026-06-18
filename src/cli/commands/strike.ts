import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { spawnAgent } from '../../lib/agents.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import type { RoleEffort } from '../../lib/config-yaml.js';

const execAsync = promisify(exec);

export interface StrikeOptions {
  model?: string;
  harness?: 'claude-code' | 'pi' | 'codex';
  effort?: RoleEffort;
  dryRun?: boolean;
}

interface StrikePlan {
  issueId: string;
  workspace: string;
  branch: string;
  sessionName: string;
  projectRoot: string;
}

/**
 * Resolve the strike workspace path for an issue. Strike workspaces live next
 * to normal feature workspaces but use the suffix `-strike` so they cannot
 * collide with a long-running pipeline workspace for the same issue.
 */
function planStrike(issueId: string): StrikePlan {
  const normalized = issueId.toLowerCase();
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) {
    throw new Error(`No Overdeck project is configured for issue prefix in "${issueId}". Add the project to projects.yaml first.`);
  }
  const workspace = join(project.projectPath, 'workspaces', `feature-${normalized}-strike`);
  return {
    issueId: issueId.toUpperCase(),
    workspace,
    branch: `strike/${normalized}`,
    sessionName: `strike-${normalized}`,
    projectRoot: project.projectPath,
  };
}

/**
 * Create the strike workspace as a git worktree on a new `strike/<id>` branch.
 * If the worktree already exists, reuse it (no-op).
 */
async function ensureStrikeWorktree(plan: StrikePlan): Promise<void> {
  if (existsSync(plan.workspace)) {
    return;
  }
  mkdirSync(join(plan.workspace, '..'), { recursive: true });

  // Create the branch from origin/main (fetch first to make sure we're current).
  try {
    await execAsync('git fetch origin main', { cwd: plan.projectRoot });
  } catch {
    /* non-fatal — proceed with local main */
  }

  // Worktree add: branch may already exist locally from a prior strike run.
  let branchExists = false;
  try {
    await execAsync(`git show-ref --verify --quiet refs/heads/${plan.branch}`, { cwd: plan.projectRoot });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await execAsync(
      `git worktree add ${JSON.stringify(plan.workspace)} ${JSON.stringify(plan.branch)}`,
      { cwd: plan.projectRoot },
    );
  } else {
    await execAsync(
      `git worktree add -b ${JSON.stringify(plan.branch)} ${JSON.stringify(plan.workspace)} origin/main`,
      { cwd: plan.projectRoot },
    );
  }
}

function buildStrikePrompt(plan: StrikePlan): string {
  return [
    `# Strike: ${plan.issueId}`,
    '',
    'You are a strike agent. Read your role definition (`roles/strike.md`) for the full contract.',
    '',
    '## Your assignment',
    '',
    `- **Issue:** ${plan.issueId}`,
    `- **Workspace:** ${plan.workspace}`,
    `- **Branch:** ${plan.branch} (already checked out)`,
    '',
    '## What to do',
    '',
    `1. Read the issue body for ${plan.issueId} (use \`gh issue view\` or your tracker tool).`,
    '2. Implement the fix in this workspace, scoped to the actual change requested.',
    '3. Commit on the strike branch with a clear message.',
    '4. Rebase onto `origin/main`, then merge fast-forward to `main` and push.',
    '5. Verify ON main with `npm run typecheck && npm test`.',
    '6. Report the result. Do NOT call `pan done` — strike does not enter the review pipeline.',
    '',
    'If mid-strike you discover the issue is broader than a precision fix, abort, do not push, and report why so the issue can run through the normal pipeline instead.',
  ].join('\n');
}

async function runOne(issueId: string, options: StrikeOptions): Promise<void> {
  const spinner = ora(`Striking ${issueId}...`).start();
  try {
    const plan = planStrike(issueId);

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.bold(`\n[dry-run] Would strike ${plan.issueId}`));
      console.log(`  Workspace:  ${plan.workspace}`);
      console.log(`  Branch:     ${plan.branch}`);
      console.log(`  Session:    ${plan.sessionName}`);
      console.log(`  Harness:    ${options.harness ?? 'claude-code'}`);
      console.log(`  Effort:     ${options.effort ?? 'medium'}`);
      if (options.model) console.log(`  Model:      ${options.model}`);
      return;
    }

    spinner.text = `Preparing strike workspace for ${plan.issueId}...`;
    await ensureStrikeWorktree(plan);

    spinner.text = `Spawning strike agent for ${plan.issueId}...`;
    const prompt = buildStrikePrompt(plan);
    const agent = await spawnAgent({
      issueId: plan.issueId,
      workspace: plan.workspace,
      harness: options.harness,
      model: options.model,
      role: 'strike',
      prompt,
      effort: options.effort,
    });

    spinner.succeed(`Strike agent spawned: ${agent.id}`);
    console.log('');
    console.log(chalk.bold('Strike Details:'));
    console.log(`  Session:    ${chalk.cyan(agent.id)}`);
    console.log(`  Workspace:  ${plan.workspace}`);
    console.log(`  Branch:     ${plan.branch}`);
    console.log(`  Harness:    ${agent.harness ?? 'claude-code'}`);
    console.log(`  Model:      ${agent.model}`);
    console.log('');
    console.log(chalk.dim('Commands:'));
    console.log(`  Attach:   tmux -L overdeck attach -t ${agent.id}`);
    console.log(`  Message:  pan tell ${plan.issueId.toLowerCase()} "your message"`);
    console.log(`  Kill:     pan kill ${plan.issueId.toLowerCase()}`);
  } catch (error: any) {
    spinner.fail(`Strike ${issueId} failed: ${error?.message ?? String(error)}`);
    throw error;
  }
}

/**
 * `pan strike <id> [<id>...]` — spawn one or more strike agents.
 * Each strike skips the normal pipeline and merges directly to main.
 */
export async function strikeCommand(ids: string[], options: StrikeOptions = {}): Promise<void> {
  if (!ids || ids.length === 0) {
    console.error(chalk.red('Issue ID required. Usage: pan strike <id> [<id>...]'));
    process.exit(1);
  }

  let failures = 0;
  for (const id of ids) {
    try {
      await runOne(id, options);
    } catch {
      failures += 1;
    }
  }

  if (failures > 0) {
    console.error(chalk.red(`\n${failures} of ${ids.length} strike(s) failed`));
    process.exit(1);
  }
}

export const __testInternals = {
  planStrike,
  buildStrikePrompt,
};
