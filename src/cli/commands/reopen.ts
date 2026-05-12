import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { LinearClient } from '@linear/sdk';
import { reopenWorkspaceState } from '../../lib/reopen.js';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import { getTrackerContext } from '../../lib/cloister/work-agent-prompt.js';
import { resolveProjectFromIssue } from '../../lib/projects.js';
import { resolveTrackerType, isGitHubIssue, resolveGitHubIssue } from '../../lib/tracker-utils.js';

interface ReopenOptions {
  json?: boolean;
  force?: boolean;
  reason?: string;
}

export interface LinearComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

/**
 * Fetch issue with comments from Linear
 */
async function fetchIssueWithComments(
  client: LinearClient,
  issueId: string
): Promise<{
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: string;
    url: string;
  };
  comments: LinearComment[];
}> {
  // Search for the issue
  const results = await client.searchIssues(issueId, { first: 1 });
  if (results.nodes.length === 0) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const linearIssue = results.nodes[0];
  const state = await linearIssue.state;

  // Fetch full Issue object to access comments() (IssueSearchResult lacks this method)
  const fullIssue = await client.issue(linearIssue.id);
  const commentsData = await fullIssue.comments();
  const comments: LinearComment[] = [];

  for (const comment of commentsData.nodes) {
    const user = await comment.user;
    comments.push({
      id: comment.id,
      body: comment.body,
      author: user?.name ?? 'Unknown',
      createdAt: comment.createdAt.toISOString(),
    });
  }

  return {
    issue: {
      id: linearIssue.id,
      identifier: linearIssue.identifier,
      title: linearIssue.title,
      description: linearIssue.description || undefined,
      state: state?.name || 'Unknown',
      url: linearIssue.url,
    },
    comments,
  };
}

/**
 * Transition issue to "In Progress" state (not Backlog)
 */
async function transitionToInProgress(client: LinearClient, issueId: string): Promise<void> {
  const results = await client.searchIssues(issueId, { first: 1 });
  if (results.nodes.length === 0) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const linearIssue = results.nodes[0];
  const team = await linearIssue.team;
  if (!team) {
    throw new Error('Could not determine issue team');
  }

  const states = await team.states();

  // Prefer "In Progress" state; fall back to any "started" type
  const inProgressState =
    states.nodes.find((s) => s.name.toLowerCase() === 'in progress') ||
    states.nodes.find((s) => s.type === 'started');

  if (!inProgressState) {
    // If no "started" state, at least try backlog/unstarted
    const backlogState =
      states.nodes.find((s) => s.type === 'backlog') ||
      states.nodes.find((s) => s.type === 'unstarted');
    if (!backlogState) {
      throw new Error('No suitable state found for transition');
    }
    await client.updateIssue(linearIssue.id, { stateId: backlogState.id });
    return;
  }

  await client.updateIssue(linearIssue.id, { stateId: inProgressState.id });
}

interface GitHubIssueResult {
  number: number;
  title: string;
  state: string;
  body: string | null | undefined;
  html_url: string;
  comments: number;
}

/**
 * Fetch a GitHub issue by its full identifier (e.g., "PAN-457")
 */
async function fetchGitHubIssue(issueId: string): Promise<GitHubIssueResult> {
  const gh = resolveGitHubIssue(issueId);
  if (!gh.isGitHub) {
    throw new Error(`Issue ${issueId} is not a GitHub issue`);
  }

  const token = await getGitHubToken();
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.issues.get({
    owner: gh.owner,
    repo: gh.repo,
    issue_number: gh.number,
  });

  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body,
    html_url: data.html_url,
    comments: data.comments,
  };
}

/**
 * Transition a GitHub issue to "open" state (reopen) and add in-progress label
 */
async function reopenGitHubIssue(issueId: string): Promise<void> {
  const gh = resolveGitHubIssue(issueId);
  if (!gh.isGitHub) {
    throw new Error(`Issue ${issueId} is not a GitHub issue`);
  }

  const token = await getGitHubToken();
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: token });

  // Reopen the issue
  await octokit.issues.update({
    owner: gh.owner,
    repo: gh.repo,
    issue_number: gh.number,
    state: 'open',
  });

  // Add in-progress label
  await octokit.issues.addLabels({
    owner: gh.owner,
    repo: gh.repo,
    issue_number: gh.number,
    labels: ['in-progress'],
  });
}

/**
 * Add a comment to a GitHub issue
 */
async function addGitHubComment(issueId: string, body: string): Promise<void> {
  const gh = resolveGitHubIssue(issueId);
  if (!gh.isGitHub) {
    throw new Error(`Issue ${issueId} is not a GitHub issue`);
  }

  const token = await getGitHubToken();
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: token });

  await octokit.issues.createComment({
    owner: gh.owner,
    repo: gh.repo,
    issue_number: gh.number,
    body,
  });
}

/**
 * Get GitHub token from config-yaml or environment
 */
async function getGitHubToken(): Promise<string> {
  const { loadConfig: loadYamlConfig } = await import('../../lib/config-yaml.js');
  const yamlConfig = loadYamlConfig();
  const token = yamlConfig.config.trackerKeys?.github || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN not found in config or environment');
  }
  return token;
}

/**
 * Format comments for display
 */
export function formatComments(comments: LinearComment[]): string {
  if (comments.length === 0) {
    return 'No comments';
  }

  return comments
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((c) => {
      const date = new Date(c.createdAt).toLocaleString();
      const truncatedBody = c.body.length > 200 ? c.body.slice(0, 200) + '...' : c.body;
      return `  [${date}] ${c.author}:\n    ${truncatedBody.replace(/\n/g, '\n    ')}`;
    })
    .join('\n\n');
}

/**
 * Find the local workspace path for an issue.
 *
 * @param issueId - Issue identifier (e.g., "PAN-256")
 * @param startDir - Directory to begin upward search from (defaults to process.cwd())
 */
export function findLocalWorkspace(issueId: string, startDir?: string): string | null {
  const normalizedId = issueId.toLowerCase();

  // Try project registry first
  const resolved = resolveProjectFromIssue(issueId, []);
  if (resolved) {
    const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${normalizedId}`);
    if (existsSync(workspacePath)) return workspacePath;
  }

  // Fall back to searching upward from startDir (or cwd)
  let dir = startDir ?? process.cwd();
  for (let i = 0; i < 10; i++) {
    const workspacesDir = join(dir, 'workspaces');
    if (existsSync(workspacesDir)) {
      const workspacePath = join(workspacesDir, `feature-${normalizedId}`);
      if (existsSync(workspacePath)) return workspacePath;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export async function reopenCommand(id: string, options: ReopenOptions = {}): Promise<void> {
  // Resolve tracker type using the same logic as `pan start` so GitHub issues
  // (e.g. pan-457) don't misroute to Linear (MIN-848).
  const trackerType = resolveTrackerType(id);

  if (trackerType === 'github') {
    await reopenGitHubIssueCommand(id, options);
  } else {
    await reopenLinearIssueCommand(id, options);
  }
}

async function reopenGitHubIssueCommand(id: string, options: ReopenOptions): Promise<void> {
  const spinner = ora(`Fetching issue ${id}...`).start();

  try {
    // Fetch issue from GitHub
    spinner.text = 'Fetching issue from GitHub...';
    const issue = await fetchGitHubIssue(id);
    spinner.stop();

    // Display issue info
    console.log('');
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    console.log(chalk.bold(`  Reopen: ${id.toUpperCase()}`));
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    console.log('');
    console.log(chalk.bold('Title:'), issue.title);
    console.log(chalk.bold('Current State:'), issue.state);
    console.log(chalk.bold('URL:'), issue.html_url);
    console.log('');

    // Show description preview
    if (issue.body) {
      console.log(chalk.bold('Description:'));
      const descPreview = issue.body.length > 300 ? issue.body.slice(0, 300) + '...' : issue.body;
      console.log(chalk.dim(descPreview));
      console.log('');
    }

    // Show comments count
    console.log(chalk.bold(`Comments:`), issue.comments);
    console.log('');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({ issue }, null, 2));
      return;
    }

    // Confirm reopen
    if (!options.force) {
      const confirm = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: `Reopen ${id.toUpperCase()} and reset workspace state?`,
          default: true,
        },
      ]);

      if (!confirm.proceed) {
        console.log(chalk.yellow('Cancelled'));
        return;
      }
    }

    // Transition the issue to open and add in-progress label
    const transitionSpinner = ora('Reopening issue and adding in-progress label...').start();
    await reopenGitHubIssue(id);
    transitionSpinner.succeed(`Issue ${id.toUpperCase()} reopened`);

    // Add a comment about reopening
    const commentSpinner = ora('Adding reopen comment...').start();
    const reasonText = options.reason ? ` Reason: ${options.reason}.` : '';
    await addGitHubComment(
      id,
      `Issue reopened for re-work via Panopticon.${reasonText}\n\nPrevious state: ${issue.state}`
    );
    commentSpinner.succeed('Added reopen comment');

    // Workspace state reset (same as Linear — uses resolveProjectFromIssue internally)
    await resetWorkspaceState(id, options);

    console.log('');
    console.log(chalk.green(`✓ ${id.toUpperCase()} reopened and ready for re-work`));
    console.log('');
    printNextSteps(id);
  } catch (error: unknown) {
    if (spinner.isSpinning) spinner.fail();
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

async function reopenLinearIssueCommand(id: string, options: ReopenOptions): Promise<void> {
  const spinner = ora(`Fetching issue ${id}...`).start();

  try {
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      spinner.fail('LINEAR_API_KEY not found');
      console.log('');
      console.log(chalk.dim('Set it in ~/.panopticon.env:'));
      console.log('  LINEAR_API_KEY=lin_api_xxxxx');
      process.exit(1);
    }

    const client = new LinearClient({ apiKey });

    // Fetch issue with comments
    spinner.text = 'Fetching issue and comments...';
    const { issue, comments } = await fetchIssueWithComments(client, id);

    spinner.stop();

    // Display issue info
    console.log('');
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    console.log(chalk.bold(`  Reopen: ${issue.identifier}`));
    console.log(chalk.bold('═══════════════════════════════════════════════════════════'));
    console.log('');
    console.log(chalk.bold('Title:'), issue.title);
    console.log(chalk.bold('Current State:'), issue.state);
    console.log(chalk.bold('URL:'), issue.url);
    console.log('');

    // Show description preview
    if (issue.description) {
      console.log(chalk.bold('Description:'));
      const descPreview =
        issue.description.length > 300 ? issue.description.slice(0, 300) + '...' : issue.description;
      console.log(chalk.dim(descPreview));
      console.log('');
    }

    // Show comments
    console.log(chalk.bold(`Comments (${comments.length}):`));
    if (comments.length > 0) {
      console.log(formatComments(comments));
    } else {
      console.log(chalk.dim('  No comments'));
    }
    console.log('');

    // JSON output
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            issue,
            comments,
          },
          null,
          2
        )
      );
      return;
    }

    // Guard: if the issue is already in an in-progress / open state, `pan reopen`
    // is almost never the right verb. The user probably wants `pan review restart`
    // (or `pan review reset`) — both leave the workspace, branch, and PR untouched
    // and only re-trigger the specialist pipeline. `pan reopen` is meant for issues
    // that have been closed/completed/cancelled and need to re-enter the pipeline.
    const stateLower = issue.state.toLowerCase();
    const inProgressLike =
      stateLower === 'in progress' ||
      stateLower === 'in review' ||
      stateLower === 'todo' ||
      stateLower === 'backlog' ||
      stateLower === 'open' ||
      stateLower.startsWith('in '); // catches "In Test", "In Verification", etc.

    if (inProgressLike && !options.force) {
      console.log(chalk.yellow(`Heads up: ${issue.identifier} is already in state "${issue.state}".`));
      console.log('');
      console.log(`\`pan reopen\` is for re-entering the pipeline after an issue was`);
      console.log(`closed/completed/cancelled. For an issue that is already open, you`);
      console.log(`probably want one of:`);
      console.log('');
      console.log(`  ${chalk.cyan(`pan review restart ${issue.identifier}`)}   kill stuck reviewers and dispatch a fresh review`);
      console.log(`  ${chalk.cyan(`pan review reset   ${issue.identifier}`)}   reset review/test/merge cycles (human override)`);
      console.log(`  ${chalk.cyan(`pan review abort   ${issue.identifier}`)}   kill running reviewers, leave the worker idle`);
      console.log('');
      console.log(`If you really want to reset specialist state via reopen anyway, re-run with ${chalk.bold('--force')}.`);
      return;
    }

    // Confirm reopen
    if (!options.force) {
      const confirm = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: `Reopen ${issue.identifier} and reset workspace state?`,
          default: true,
        },
      ]);

      if (!confirm.proceed) {
        console.log(chalk.yellow('Cancelled'));
        return;
      }
    }

    // Transition the issue to In Progress
    const transitionSpinner = ora('Transitioning issue to In Progress...').start();
    await transitionToInProgress(client, id);
    transitionSpinner.succeed(`Issue ${issue.identifier} moved to In Progress`);

    // Add a comment about reopening
    const commentSpinner = ora('Adding reopen comment...').start();
    const reasonText = options.reason ? ` Reason: ${options.reason}.` : '';
    await client.createComment({
      issueId: issue.id,
      body: `Issue reopened for re-work via Panopticon.${reasonText}\n\nPrevious state: ${issue.state}`,
    });
    commentSpinner.succeed('Added reopen comment');

    // Workspace state reset
    await resetWorkspaceState(id, options);

    console.log('');
    console.log(chalk.green(`✓ ${issue.identifier} reopened and ready for re-work`));
    console.log('');
    printNextSteps(id);
  } catch (error: unknown) {
    if (spinner.isSpinning) spinner.fail();
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

/**
 * Shared workspace state reset logic for both GitHub and Linear reopen paths.
 * Uses resolveProjectFromIssue internally so it works for any tracker.
 */
async function resetWorkspaceState(id: string, options: ReopenOptions): Promise<void> {
  const workspacePath = findLocalWorkspace(id);
  let trackerContext: string | undefined;

  if (workspacePath) {
    // Fetch tracker context to attach to the continue file (reuse PAN-253 pattern)
    try {
      trackerContext = await getTrackerContext(id, workspacePath);
    } catch {
      // Non-fatal: tracker context is best-effort
    }

    const resetSpinner = ora('Resetting workspace state...').start();
    const result = await reopenWorkspaceState(id, workspacePath, {
      reason: options.reason,
      trackerContext,
    });
    resetSpinner.succeed('Workspace state reset');

    console.log('');
    console.log(chalk.bold('Reset summary:'));
    if (result.previousReviewStatus) {
      console.log(`  Review: ${chalk.yellow(result.previousReviewStatus)} → ${chalk.green('pending')}`);
    }
    if (result.previousTestStatus) {
      console.log(`  Test:   ${chalk.yellow(result.previousTestStatus)} → ${chalk.green('pending')}`);
    }
    if (result.previousMergeStatus) {
      console.log(`  Merge:  ${chalk.yellow(result.previousMergeStatus)} → ${chalk.green('pending')}`);
    }

    const queueEntries = Object.entries(result.queueItemsRemoved);
    if (queueEntries.length > 0) {
      console.log(`  Queue items removed:`);
      for (const [specialist, count] of queueEntries) {
        console.log(`    ${specialist}: ${count} item(s)`);
      }
    }

    if (result.continueFileUpdated) {
      console.log(`  Continue file updated with reopen breadcrumb`);
    }
  } else {
    console.log('');
    console.log(chalk.yellow(`  No local workspace found for ${id} — skipping workspace state reset`));
    console.log(chalk.dim('  Specialist states were not modified.'));
  }
}

async function printNextSteps(id: string): Promise<void> {
  // Check if agent is currently running and suggest appropriate next step
  try {
    const { getAgentState } = await import('../../lib/agents.js');
    const agentId = `agent-${id.toLowerCase()}`;
    const agentState = getAgentState(agentId);
    const agentRunning = agentState?.status === 'running' || agentState?.status === 'starting';

    if (agentRunning) {
      console.log(chalk.dim('Agent is still running. Send it context about the re-work:'));
      console.log(`  pan tell ${id} "Issue reopened. <describe what needs to change>"`);
    } else {
      console.log(chalk.dim('Start the agent to resume implementation:'));
      console.log(`  pan start ${id}`);
    }
  } catch {
    // Fallback if agent state check fails
    console.log(chalk.dim('Start the agent to resume implementation:'));
    console.log(`  pan start ${id}`);
  }
  console.log('');
}
