import chalk from 'chalk';
import ora from 'ora';
import { saveAgentRuntimeState } from '../../../lib/agents.js';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AGENTS_DIR } from '../../../lib/paths.js';
import { shouldSkipTrackerUpdate } from '../../../lib/shadow-mode.js';
import { updateShadowState } from '../../../lib/shadow-state.js';

interface DoneOptions {
  comment?: string;
  noLinear?: boolean;
  shadow?: boolean;
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

function getGitHubConfig(): { token: string; repos: { owner: string; repo: string; prefix: string }[] } | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return null;
  const content = readFileSync(envFile, 'utf-8');
  const tokenMatch = content.match(/GITHUB_TOKEN=(.+)/);
  if (!tokenMatch) return null;
  const token = tokenMatch[1].trim();
  const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
  if (!reposMatch) return null;
  const repos = reposMatch[1].trim().split(',').map(r => {
    const [repoPath, prefix] = r.trim().split(':');
    const [owner, repo] = repoPath.split('/');
    return { owner, repo, prefix };
  }).filter(r => r.owner && r.repo);
  if (repos.length === 0) return null;
  return { token, repos };
}

async function updateGitHubToInReview(issueId: string, comment?: string): Promise<boolean> {
  try {
    const ghConfig = getGitHubConfig();
    if (!ghConfig) return false;

    const number = parseInt(issueId.split('-')[1], 10);
    const repoConfig = ghConfig.repos.find(r => r.prefix === 'PAN') || ghConfig.repos[0];
    const { owner, repo } = repoConfig;
    const token = ghConfig.token;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };

    // Remove "in-progress" label
    await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/in-progress`, {
      method: 'DELETE', headers,
    }).catch(() => {});

    // Add "in-review" label
    await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'POST', headers,
      body: JSON.stringify({ labels: ['in-review'] }),
    });

    // Add completion comment
    if (comment) {
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`, {
        method: 'POST', headers,
        body: JSON.stringify({ body: `🤖 **Agent completed work:**\n\n${comment}` }),
      });
    }

    return true;
  } catch (error) {
    console.error('GitHub API error:', error);
    return false;
  }
}

export async function doneCommand(id: string, options: DoneOptions = {}): Promise<void> {
  // Support both "pan work done MIN-123" and "pan work done agent-min-123"
  const issueId = id.replace(/^agent-/i, '').toUpperCase();
  const agentId = `agent-${issueId.toLowerCase()}`;

  const spinner = ora('Marking work as done...').start();

  try {
    let trackerUpdated = false;
    let shadowModeActive = false;
    const isGitHubIssue = issueId.startsWith('PAN-');

    // Step 1: Update status (either tracker or shadow)
    const skipTrackerUpdate = shouldSkipTrackerUpdate(issueId, options.shadow);

    if (skipTrackerUpdate) {
      shadowModeActive = true;
      spinner.text = 'Updating shadow state...';
      updateShadowState(issueId, 'closed', 'pan work done');
      console.log(chalk.cyan(`  👻 Shadow mode: status updated locally`));
    } else if (isGitHubIssue) {
      // GitHub issue - update labels
      spinner.text = 'Updating GitHub labels...';
      trackerUpdated = await updateGitHubToInReview(issueId, options.comment);
      if (trackerUpdated) {
        console.log(chalk.green(`  ✓ Updated ${issueId} to In Review (GitHub)`));
      } else {
        console.log(chalk.yellow(`  ⚠ Failed to update GitHub labels`));
      }
    } else if (options.noLinear !== true) {
      const apiKey = getLinearApiKey();
      if (apiKey) {
        spinner.text = 'Updating Linear to In Review...';
        trackerUpdated = await updateLinearToInReview(apiKey, issueId, options.comment);
        if (trackerUpdated) {
          console.log(chalk.green(`  ✓ Updated ${issueId} to In Review`));
        } else {
          console.log(chalk.yellow(`  ⚠ Failed to update Linear status`));
        }
      } else {
        console.log(chalk.dim('  LINEAR_API_KEY not set - skipping status update'));
      }
    }

    // Step 2: Update agent state to stopped (so it appears in dashboard agents list)
    const { getAgentState, saveAgentState } = await import('../../../lib/agents.js');
    const existingState = getAgentState(agentId);
    if (existingState) {
      existingState.status = 'stopped';
      existingState.lastActivity = new Date().toISOString();
      saveAgentState(existingState);
    }
    // Also update runtime state to idle
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });

    // Step 3: Write completion marker
    mkdirSync(join(AGENTS_DIR, agentId), { recursive: true });
    const completedFile = join(AGENTS_DIR, agentId, 'completed');
    writeFileSync(completedFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      trackerUpdated,
      comment: options.comment,
    }));

    spinner.succeed(`Work complete: ${issueId}`);
    console.log('');

    // Summary
    console.log(chalk.bold('Summary:'));
    console.log(`  Issue:   ${chalk.cyan(issueId)}`);
    if (shadowModeActive) {
      console.log(`  Status:  ${chalk.cyan('👻 Shadow mode - pending sync to tracker')}`);
    } else {
      console.log(`  Tracker: ${trackerUpdated ? chalk.green('Updated to In Review') : chalk.dim('Not updated')}`);
    }
    if (options.comment) {
      console.log(`  Comment: ${chalk.dim(options.comment.slice(0, 50))}${options.comment.length > 50 ? '...' : ''}`);
    }
    console.log('');

    console.log(chalk.dim('Ready for review. When approved, run:'));
    console.log(chalk.dim(`  pan work approve ${issueId}`));
    console.log('');

    // Auto-trigger review & test (respecting circuit breaker)
    try {
      const { getDashboardApiUrl } = await import('../../../lib/config.js');
      const dashboardUrl = getDashboardApiUrl();

      // Check if dashboard is running
      const http = await import('http');
      const checkDashboard = () => new Promise<boolean>((resolve) => {
        const req = http.request(`${dashboardUrl}/api/health`, { method: 'GET', timeout: 2000 }, (res) => {
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
