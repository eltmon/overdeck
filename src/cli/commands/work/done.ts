import chalk from 'chalk';
import ora from 'ora';
import { getAgentState, saveAgentState, saveAgentRuntimeState } from '../../../lib/agents.js';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AGENTS_DIR } from '../../../lib/paths.js';

interface DoneOptions {
  comment?: string;
  noLinear?: boolean;
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

async function updateLinearToInReview(apiKey: string, issueIdentifier: string, comment?: string): Promise<boolean> {
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    // Get the team and find the In Review state
    const me = await client.viewer;
    const teams = await me.teams();
    const team = teams.nodes[0];

    if (!team) return false;

    // Find the issue
    const issues = await team.issues({ first: 100 });
    const issue = issues.nodes.find(
      (i) => i.identifier.toUpperCase() === issueIdentifier.toUpperCase()
    );

    if (!issue) return false;

    // Find the In Review state
    const states = await team.states();
    const inReviewState = states.nodes.find((s) => s.name === 'In Review');

    if (!inReviewState) {
      // Fallback: try to find any state with "review" in the name
      const reviewState = states.nodes.find((s) =>
        s.name.toLowerCase().includes('review')
      );
      if (!reviewState) return false;

      await issue.update({ stateId: reviewState.id });
    } else {
      await issue.update({ stateId: inReviewState.id });
    }

    // Add "Review Ready" label to indicate agent completed work
    const labels = await team.labels();
    let reviewReadyLabel = labels.nodes.find((l) => l.name === 'Review Ready');

    // Create the label if it doesn't exist
    if (!reviewReadyLabel) {
      const created = await client.createIssueLabel({
        teamId: team.id,
        name: 'Review Ready',
        color: '#22c55e', // Green
        description: 'Agent has completed work and is ready for human review',
      });
      if (created.issueLabel) {
        reviewReadyLabel = await created.issueLabel;
      }
    }

    // Add label to issue (preserving existing labels)
    if (reviewReadyLabel) {
      const existingLabels = await issue.labels();
      const labelIds = existingLabels.nodes.map((l) => l.id);
      if (!labelIds.includes(reviewReadyLabel.id)) {
        labelIds.push(reviewReadyLabel.id);
        await issue.update({ labelIds });
      }
    }

    // Add completion comment if provided
    if (comment) {
      await client.createComment({
        issueId: issue.id,
        body: `🤖 **Agent completed work:**\n\n${comment}`,
      });
    }

    return true;
  } catch (error) {
    console.error('Linear API error:', error);
    return false;
  }
}

export async function doneCommand(id: string, options: DoneOptions = {}): Promise<void> {
  // Support both "pan work done MIN-123" and "pan work done agent-min-123"
  const issueId = id.replace(/^agent-/i, '').toUpperCase();
  const agentId = `agent-${issueId.toLowerCase()}`;

  const spinner = ora('Marking work as done...').start();

  try {
    let linearUpdated = false;

    // Step 1: Update Linear status to "In Review"
    if (options.noLinear !== true) {
      const apiKey = getLinearApiKey();
      if (apiKey) {
        spinner.text = 'Updating Linear to In Review...';
        linearUpdated = await updateLinearToInReview(apiKey, issueId, options.comment);
        if (linearUpdated) {
          console.log(chalk.green(`  ✓ Updated ${issueId} to In Review`));
        } else {
          console.log(chalk.yellow(`  ⚠ Failed to update Linear status`));
        }
      } else {
        console.log(chalk.dim('  LINEAR_API_KEY not set - skipping status update'));
      }
    }

    // Step 2: Update agent state if it exists
    const state = getAgentState(agentId);
    if (state) {
      state.lastActivity = new Date().toISOString();
      saveAgentState(state);

      // Update runtime state to idle
      saveAgentRuntimeState(agentId, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
      });
    }

    // Step 3: Write completion marker
    const completedFile = join(AGENTS_DIR, agentId, 'completed');
    writeFileSync(completedFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      linearUpdated,
      comment: options.comment,
    }));

    spinner.succeed(`Work complete: ${issueId}`);
    console.log('');

    // Summary
    console.log(chalk.bold('Summary:'));
    console.log(`  Issue:   ${chalk.cyan(issueId)}`);
    console.log(`  Linear:  ${linearUpdated ? chalk.green('Updated to In Review') : chalk.dim('Not updated')}`);
    if (options.comment) {
      console.log(`  Comment: ${chalk.dim(options.comment.slice(0, 50))}${options.comment.length > 50 ? '...' : ''}`);
    }
    console.log('');

    console.log(chalk.dim('Ready for review. When approved, run:'));
    console.log(chalk.dim(`  pan work approve ${issueId}`));
    console.log('');

    // Auto-trigger review & test (respecting circuit breaker)
    try {
      const dashboardUrl = 'http://localhost:3011';

      // Check if dashboard is running
      const http = await import('http');
      const checkDashboard = () => new Promise<boolean>((resolve) => {
        const req = http.request(`${dashboardUrl}/health`, { method: 'GET', timeout: 1000 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
      });

      const dashboardRunning = await checkDashboard();

      if (dashboardRunning) {
        console.log(chalk.dim('Auto-triggering review & test...'));

        // Trigger review endpoint
        const reviewReq = () => new Promise<any>((resolve, reject) => {
          const postData = JSON.stringify({});
          const req = http.request(
            `${dashboardUrl}/api/workspaces/${issueId}/review`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 5000 },
            (res) => {
              let data = '';
              res.on('data', (chunk) => data += chunk);
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch {
                  resolve({ success: false, error: 'Invalid response' });
                }
              });
            }
          );
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
          req.write(postData);
          req.end();
        });

        const result = await reviewReq();

        if (result.success) {
          console.log(chalk.green(`  ✓ Review & test ${result.queued ? 'queued' : 'started'} automatically`));
        } else {
          // Don't fail the command if review trigger fails - just inform
          console.log(chalk.yellow(`  ⚠ Auto-review not triggered: ${result.error || result.message || 'Unknown error'}`));
          if (result.alreadyReviewed) {
            console.log(chalk.dim(`    Manual review needed - click "Review and Test" in dashboard`));
          }
        }
      } else {
        console.log(chalk.dim('  Dashboard not running - skipping auto-review'));
        console.log(chalk.dim('  Start dashboard with: pan up'));
      }
    } catch (error: any) {
      // Don't fail the done command if auto-review fails
      console.log(chalk.dim(`  Could not auto-trigger review: ${error.message}`));
    }

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
