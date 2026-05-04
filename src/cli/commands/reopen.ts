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

    // Find workspace and reset state
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

    console.log('');
    console.log(chalk.green(`✓ ${issue.identifier} reopened and ready for re-work`));
    console.log('');

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
  } catch (error: unknown) {
    if (spinner.isSpinning) spinner.fail();
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}
