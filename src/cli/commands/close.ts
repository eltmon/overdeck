/**
 * pan close <id> — Human-gated close-out ceremony for completed issues.
 *
 * Verifies merge, archives artifacts, cleans up workspace/agent state,
 * closes the issue on the tracker, and applies the `closed-out` label.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { closeOut, type WorkflowResult } from '../../lib/lifecycle/index.js';
import { resolveProjectFromIssueSync, extractTeamPrefix, findProjectByTeamSync } from '../../lib/projects.js';
import { mapGitHubStateToCanonical, type CanonicalState } from '../../core/state-mapping.js';

const execFileAsync = promisify(execFile);

interface CloseOutOptions {
  force?: boolean;
  json?: boolean;
}

function getGitHubConfig(): { owner: string; repo: string; prefix: string } | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return null;

  const content = readFileSync(envFile, 'utf-8');
  const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
  if (!reposMatch) return null;

  const repoStr = reposMatch[1].trim();
  // Format: owner/repo:PREFIX or owner/repo
  const parts = repoStr.split(',')[0]; // Take first repo
  if (!parts) return null;

  const [ownerRepo, prefix] = parts.split(':');
  const [owner, repo] = ownerRepo.split('/');
  if (!owner || !repo) return null;

  return { owner, repo, prefix: prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, '') };
}

async function readGitHubCanonicalState(owner: string, repo: string, number: number): Promise<CanonicalState> {
  const { stdout } = await execFileAsync('gh', [
    'issue',
    'view',
    String(number),
    '--repo',
    `${owner}/${repo}`,
    '--json',
    'state,labels',
  ], { encoding: 'utf-8' });
  const parsed = JSON.parse(stdout) as { state?: string; labels?: Array<string | { name?: string }> };
  const labels = (parsed.labels ?? [])
    .map(label => typeof label === 'string' ? label : label.name)
    .filter((label): label is string => typeof label === 'string');
  return mapGitHubStateToCanonical(parsed.state ?? 'open', labels);
}

export async function closeOutCommand(issueId: string, options: CloseOutOptions): Promise<void> {
  // Human-only guard: reject if running as an agent
  if (process.env.PANOPTICON_AGENT_ID) {
    console.error(chalk.red('Close-out is a human-only operation. Agents cannot close out issues.'));
    process.exit(1);
  }

  const issueLower = issueId.toLowerCase();
  const issueUpper = issueId.toUpperCase();

  // Resolve project
  const teamPrefix = extractTeamPrefix(issueId);
  const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
  let projectPath = '';

  if (projectConfig) {
    projectPath = projectConfig.path;
  } else {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (resolved) {
      projectPath = resolved.projectPath;
    }
  }

  if (!projectPath) {
    console.error(chalk.red(`Could not resolve project for ${issueId}`));
    process.exit(1);
  }

  // Determine tracker type
  const isGitHub = issueUpper.startsWith('PAN-');
  let owner: string | undefined;
  let repo: string | undefined;
  let number: number | undefined;

  if (isGitHub) {
    const ghConfig = getGitHubConfig();
    if (ghConfig) {
      owner = ghConfig.owner;
      repo = ghConfig.repo;
      number = parseInt(issueId.replace(/^PAN-/i, ''), 10);
    } else {
      // Fallback for PAN- issues
      owner = 'eltmon';
      repo = 'panopticon-cli';
      number = parseInt(issueId.replace(/^PAN-/i, ''), 10);
    }
  }

  let canonicalState: CanonicalState | null = null;
  let canonicalStateError: string | null = null;
  if (isGitHub && owner && repo && number) {
    try {
      canonicalState = await readGitHubCanonicalState(owner, repo, number);
    } catch (error) {
      canonicalStateError = error instanceof Error ? error.message : String(error);
    }
  }

  // Confirmation
  if (!options.force) {
    console.log(chalk.yellow(`\nClose-out ceremony for ${issueUpper}\n`));
    console.log(chalk.gray(`Issue should normally be in 'verifying-on-main' before close-out.`));
    if (canonicalState && canonicalState !== 'verifying_on_main') {
      console.log(chalk.yellow(`Warning: current canonical state is '${canonicalState}', not 'verifying_on_main'.`));
    } else if (canonicalStateError) {
      console.log(chalk.yellow(`Warning: could not read current canonical state: ${canonicalStateError}`));
    }
    console.log();
    console.log(chalk.gray('This will:'));
    console.log(chalk.gray('  1. Verify PRD is preserved'));
    console.log(chalk.gray('  2. Verify branch is fully merged'));
    console.log(chalk.gray('  3. Archive workspace artifacts'));
    console.log(chalk.gray('  4. Clean up workspace (tmux, Docker, worktree)'));
    console.log(chalk.gray('  5. Clean up agent state'));
    console.log(chalk.gray('  6. Close issue on tracker'));
    console.log(chalk.gray('  7. Apply closed-out label'));
    console.log(chalk.gray('  8. Clear review status'));
    console.log();

    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question(chalk.yellow(`Proceed with close-out? [y/N] `), (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });

    if (!confirmed) {
      console.log(chalk.gray('Aborted.'));
      return;
    }
  }

  console.log(chalk.blue(`\nRunning close-out for ${issueUpper}...\n`));

  const ctx = {
    issueId,
    projectPath,
    ...(isGitHub && owner && repo && number
      ? { github: { owner, repo, number } }
      : {}),
  };

  const result = await Effect.runPromise(closeOut(ctx));

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Display step results
  for (const step of result.steps) {
    const icon = step.success ? (step.skipped ? chalk.yellow('⊘') : chalk.green('✓'))
      : chalk.red('✗');
    const msg = step.error
      ? chalk.gray(` — ${step.error}`)
      : step.details?.length
        ? chalk.gray(` — ${step.details.join('; ')}`)
        : '';
    console.log(`  ${icon} ${step.step}${msg}`);
  }

  console.log();

  if (result.success) {
    console.log(chalk.green(`Close-out complete for ${issueUpper}.`));
  } else {
    const failedStep = result.steps.find(s => !s.success && !s.skipped);
    console.log(chalk.red(`Close-out failed: ${failedStep?.error || 'Unknown error'}`));
    process.exit(1);
  }
}
