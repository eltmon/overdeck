import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { LinearClient, Issue } from '@linear/sdk';
import { planCommand } from './plan.js';

interface ReopenOptions {
  skipPlan?: boolean;
  json?: boolean;
  force?: boolean;
}

interface LinearComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
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

  const linearIssue = results.nodes[0] as unknown as Issue;
  const state = await linearIssue.state;

  // Fetch comments
  const commentsData = await linearIssue.comments();
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
 * Transition issue back to open/backlog state
 */
async function reopenIssue(client: LinearClient, issueId: string): Promise<void> {
  // Get the issue and its team
  const results = await client.searchIssues(issueId, { first: 1 });
  if (results.nodes.length === 0) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const linearIssue = results.nodes[0];
  const team = await linearIssue.team;
  if (!team) {
    throw new Error('Could not determine issue team');
  }

  // Get workflow states
  const states = await team.states();

  // Find backlog or unstarted state (prefer backlog)
  const backlogState = states.nodes.find((s) => s.type === 'backlog');
  const unstartedState = states.nodes.find((s) => s.type === 'unstarted');
  const targetState = backlogState || unstartedState;

  if (!targetState) {
    throw new Error('No backlog or unstarted state found');
  }

  // Update the issue
  await client.updateIssue(linearIssue.id, {
    stateId: targetState.id,
  });
}

/**
 * Format comments for display
 */
function formatComments(comments: LinearComment[]): string {
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
          message: `Reopen ${issue.identifier} and run planning?`,
          default: true,
        },
      ]);

      if (!confirm.proceed) {
        console.log(chalk.yellow('Cancelled'));
        return;
      }
    }

    // Reopen the issue
    const reopenSpinner = ora('Transitioning issue to backlog...').start();
    await reopenIssue(client, id);
    reopenSpinner.succeed(`Issue ${issue.identifier} reopened`);

    // Add a comment about reopening
    const commentSpinner = ora('Adding reopen comment...').start();
    await client.createComment({
      issueId: issue.id,
      body: `Issue reopened for re-planning via Panopticon.\n\nPrevious state: ${issue.state}`,
    });
    commentSpinner.succeed('Added reopen comment');

    // Run planning (unless skipped)
    if (!options.skipPlan) {
      console.log('');
      console.log(chalk.cyan('Running planning workflow...'));
      console.log('');
      await planCommand(id, { force: true });
    } else {
      console.log('');
      console.log(chalk.green('Issue reopened. Run planning manually:'));
      console.log(`  pan work plan ${id}`);
      console.log('');
    }
  } catch (error: any) {
    if (spinner.isSpinning) spinner.fail();
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}
