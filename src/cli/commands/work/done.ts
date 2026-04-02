import chalk from 'chalk';
import ora from 'ora';
import { saveAgentRuntimeState } from '../../../lib/agents.js';
import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AGENTS_DIR } from '../../../lib/paths.js';
import { getVBriefACStatus } from '../../../lib/vbrief/beads.js';
import { shouldSkipTrackerUpdate } from '../../../lib/shadow-mode.js';
import { updateShadowState } from '../../../lib/shadow-state.js';
import { cleanupWorkflowLabels, getLinearStateName, findLinearStateByName } from '../../../core/state-mapping.js';

const execAsync = promisify(exec);

interface DoneOptions {
  comment?: string;
  noLinear?: boolean;
  shadow?: boolean;
  force?: boolean;
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

    // Deterministic lookup by identifier — no team iteration needed
    // searchIssues returns IssueSearchResult which lacks .update(); re-fetch full Issue object
    const searchResults = await client.searchIssues(issueIdentifier, { first: 1 });
    const searchHit = searchResults.nodes.find(
      (i) => i.identifier.toUpperCase() === issueIdentifier.toUpperCase()
    );

    if (!searchHit) return false;
    const issue = await client.issue(searchHit.id);

    // Get the team from the issue itself, then find the target state
    const team = await issue.team;
    if (!team) return false;

    const states = await team.states();
    const targetStateName = getLinearStateName('in_review');
    const targetState = findLinearStateByName(states.nodes, targetStateName);

    if (!targetState) {
      console.error(`Linear state "${targetStateName}" not found in team`);
      return false;
    }

    await issue.update({ stateId: targetState.id });

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

    // Get current labels
    const labelsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
      headers,
    });
    const currentLabels = labelsRes.ok ? (await labelsRes.json() as any[]).map((l: any) => l.name) : [];

    // Clean up workflow labels and get target labels for in_review state
    const targetLabels = cleanupWorkflowLabels(currentLabels, 'in_review');

    // Update labels (set all at once to replace)
    await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`, {
      method: 'PUT', headers,
      body: JSON.stringify({ labels: targetLabels }),
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

  // Pre-flight completion checks (unless --force)
  if (!options.force) {
    const { getAgentState } = await import('../../../lib/agents.js');
    const agentState = getAgentState(agentId);
    const workspacePath = agentState?.workspace;

    if (workspacePath && existsSync(workspacePath)) {
      const failures: string[] = [];

      // Check 1: Open beads for THIS issue only (not all beads in shared database)
      try {
        const { stdout } = await execAsync(
          `bd list --status open -l "${issueId.toLowerCase()}" --limit 0 --json`,
          { cwd: workspacePath }
        );
        const beads = JSON.parse(stdout);
        if (Array.isArray(beads) && beads.length > 0) {
          failures.push(`  Open beads (${beads.length}):`);
          for (const bead of beads) {
            const id = bead.id || bead.beadId || '?';
            const task = bead.task || bead.subject || bead.title || 'untitled';
            failures.push(`    - ${id} ${task}`);
          }
        }
      } catch {
        // beads CLI not installed or not a beads workspace — skip check
      }

      // Check 2: Uncommitted changes
      // Detect polyrepo (subdirs with .git) vs monorepo (top-level .git)
      const hasTopLevelGit = existsSync(join(workspacePath, '.git'));

      if (hasTopLevelGit) {
        // Monorepo — single git status check
        try {
          const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath });
          if (stdout.trim()) {
            failures.push('  Uncommitted changes:');
            for (const line of stdout.trim().split('\n')) {
              failures.push(`    ${line}`);
            }
          }
        } catch {
          // git not available or not a repo — skip
        }
      } else {
        // Polyrepo — check each subdir that has a .git file/dir
        try {
          const entries = readdirSync(workspacePath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const subPath = join(workspacePath, entry.name);
            if (!existsSync(join(subPath, '.git'))) continue;

            try {
              const { stdout } = await execAsync('git status --porcelain', { cwd: subPath });
              if (stdout.trim()) {
                failures.push(`  Uncommitted changes in ${entry.name}/:`);
                for (const line of stdout.trim().split('\n')) {
                  failures.push(`    ${line}`);
                }
              }
            } catch {
              // skip this sub-repo
            }
          }
        } catch {
          // can't read workspace dir — skip
        }
      }

      // Check 3: vBRIEF acceptance criteria completion
      try {
        const acStatus = getVBriefACStatus(workspacePath);
        if (acStatus && !acStatus.allCompleted) {
          failures.push(`  Incomplete acceptance criteria (${acStatus.totalPending}/${acStatus.totalCount}):`);
          for (const item of acStatus.items) {
            if (item.pending > 0) {
              for (const ac of item.criteria) {
                if (ac.status !== 'completed' && ac.status !== 'cancelled') {
                  failures.push(`    - [ ] ${ac.title} (${item.itemTitle})`);
                }
              }
            }
          }
        }
      } catch {
        // vBRIEF not available — skip check
      }

      if (failures.length > 0) {
        console.error(chalk.red(`\n✖ Work completion checks failed for ${issueId}:\n`));
        for (const line of failures) {
          console.error(line);
        }
        console.error('');
        console.error(chalk.dim(`  Fix these issues, then run 'pan work done ${issueId}' again.`));
        console.error(chalk.dim('  Use --force to skip checks.'));
        console.error('');
        process.exit(1);
      }
    }
  }

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

        let result = await reviewReq();

        // Self-healing: if issue was previously merged, auto-reset and retry
        if (!result.success && result.alreadyMerged) {
          console.log(chalk.yellow(`  ⚠ Issue was previously merged. Resetting specialist states for re-review...`));

          const resetReq = () => new Promise<any>((resolve, reject) => {
            const postData = JSON.stringify({});
            const req = http.request(
              `${dashboardUrl}/api/workspaces/${issueId}/reset-review`,
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

          const resetResult = await resetReq();
          if (resetResult.success) {
            console.log(chalk.green(`  ✓ Specialist states reset`));
            // Retry review
            result = await reviewReq();
          } else {
            console.log(chalk.red(`  ✗ Failed to reset: ${resetResult.error || resetResult.message || 'Unknown error'}`));
          }
        }

        if (result.success) {
          console.log(chalk.green(`  ✓ Review & test ${result.queued ? 'queued' : 'started'} automatically`));
        } else if (!result.alreadyMerged) {
          // Don't fail the command if review trigger fails - just inform
          // (alreadyMerged case already logged above)
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
