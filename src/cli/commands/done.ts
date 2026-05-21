import chalk from 'chalk';
import ora from 'ora';
import { saveAgentRuntimeState } from '../../lib/agents.js';
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import { join } from 'path';
import { homedir } from 'os';
import { AGENTS_DIR } from '../../lib/paths.js';
import { runPreflightChecks } from '../../lib/work/done-preflight.js';
import { shouldSkipTrackerUpdate } from '../../lib/shadow-mode.js';
import { updateShadowState } from '../../lib/shadow-state.js';
import { cleanupWorkflowLabels, getLinearStateName, findLinearStateByName } from '../../core/state-mapping.js';
import { Effect } from 'effect';
import { getLinearApiKey } from '../../lib/shadow-utils.js';
import { extractNumber, resolveIssueId } from '../../lib/issue-id.js';
import { getWorkspacePanPaths, readWorkspaceContinue, writeWorkspaceContinue } from '../../lib/pan-dir/index.js';
import { restoreTrackedBeadsExport } from '../../lib/bd-mutex.js';
import { resolveProjectFromIssue } from '../../lib/projects.js';
import type { MergeSet } from '../../lib/merge-set.js';

interface DoneOptions {
  comment?: string;
  force?: boolean;
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

    const number = extractNumber(issueId);
    if (number === null) return false;
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

    // Defense-in-depth: refuse to re-submit an already-closed-out issue
    if (currentLabels.some(l => l.toLowerCase() === 'closed-out')) {
      console.error(chalk.red(`\n✖ ${issueId} has already been closed out. Cannot mark work as done.\n`));
      return false;
    }

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

async function isMergeSetMergedIntoTargets(
  workspacePath: string,
  mergeSet: MergeSet | null | undefined,
): Promise<boolean> {
  if (!mergeSet || mergeSet.repos.length === 0) return false;

  for (const repo of mergeSet.repos) {
    const repoPath = mergeSet.workspaceType === 'polyrepo'
      ? join(workspacePath, repo.repoKey)
      : workspacePath;

    if (!existsSync(join(repoPath, '.git'))) return false;

    await execAsync(`git fetch origin ${repo.targetBranch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60000,
    });

    try {
      await execAsync(`git merge-base --is-ancestor HEAD origin/${repo.targetBranch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 10000,
      });
    } catch {
      return false;
    }
  }

  return true;
}

export async function doneCommand(id: string, options: DoneOptions = {}): Promise<void> {
  // Support both "pan done MIN-123" and "pan done agent-min-123"
  const issueId = resolveIssueId(id);
  const agentId = `agent-${issueId.toLowerCase()}`;

  // Guard: reject completion for already-closed issues
  if (!options.force) {
    const { resolveGitHubIssue } = await import('../../lib/tracker-utils.js');
    const ghInfo = resolveGitHubIssue(issueId);
    if (ghInfo.isGitHub) {
      try {
        const { stdout } = await execAsync(
          `gh issue view ${ghInfo.number} --repo ${ghInfo.owner}/${ghInfo.repo} --json state,labels --jq '[.state, (.labels | map(.name) | join(","))] | @tsv'`,
          { encoding: 'utf-8' }
        );
        const [state, labelsStr] = stdout.trim().split('\t');
        const stateLower = (state || '').toLowerCase();
        const labels = (labelsStr || '').split(',').filter(Boolean);
        if (stateLower === 'closed') {
          console.error(chalk.red(`\n✖ ${issueId} is already closed. Cannot mark work as done on a closed issue.\n`));
          process.exit(1);
        }
        // Defense-in-depth: refuse to re-submit an issue that has already been closed out
        if (labels.some(l => l.toLowerCase() === 'closed-out')) {
          console.error(chalk.red(`\n✖ ${issueId} has already been closed out. Cannot mark work as done on a closed-out issue.\n`));
          process.exit(1);
        }
      } catch (guardErr) {
        console.error(chalk.yellow(`\n⚠ Could not verify issue state for ${issueId} (${(guardErr as Error).message}). Aborting for safety — use --force to override.\n`));
        process.exit(1);
      }
    } else {
      const linearApiKey = Effect.runSync(getLinearApiKey());
      if (linearApiKey) {
        try {
          const { LinearClient } = await import('@linear/sdk');
          const client = new LinearClient({ apiKey: linearApiKey });
          const { extractNumber, extractPrefix } = await import('../../lib/issue-id.js');
          const issueNum = extractNumber(issueId);
          const teamKey = extractPrefix(issueId);
          if (issueNum !== null && teamKey !== null) {
            const results = await client.issues({
              filter: { number: { eq: issueNum }, team: { key: { eq: teamKey } } },
              first: 1,
            });
            if (results.nodes.length > 0) {
              const state = await results.nodes[0].state;
              if (state?.type === 'completed' || state?.type === 'canceled') {
                console.error(chalk.red(`\n✖ ${issueId} is already closed. Cannot mark work as done on a closed issue.\n`));
                process.exit(1);
              }
            }
          }
        } catch (guardErr) {
          console.error(chalk.yellow(`\n⚠ Could not verify Linear issue state for ${issueId} (${(guardErr as Error).message}). Aborting for safety — use --force to override.\n`));
          process.exit(1);
        }
      }
    }
  }

  // Pre-flight completion checks (unless --force)
  if (!options.force) {
    const { getAgentState } = await import('../../lib/agents.js');
    const agentState = getAgentState(agentId);
    const workspacePath = agentState?.workspace;

    if (workspacePath && existsSync(workspacePath)) {
      // Commit any stale workspace orchestration artifacts from a previous interrupted
      // pan done run so the uncommitted-changes gate in runPreflightChecks doesn't
      // reject them.
      try {
        const { stdout: preDirty } = await execAsync(
          'git status --porcelain .pan/',
          { cwd: workspacePath, encoding: 'utf-8' }
        );
        if (preDirty.trim()) {
          await execAsync('git add .pan/', { cwd: workspacePath });
          await execAsync('git commit -m "chore: sync planning artifacts"', { cwd: workspacePath });
        }
      } catch { /* non-fatal */ }

      const failures = await runPreflightChecks(workspacePath, issueId);

      if (failures.length > 0) {
        console.error(chalk.red(`\n✖ Work completion checks failed for ${issueId}:\n`));
        for (const line of failures) {
          console.error(line);
        }
        console.error('');
        console.error(chalk.dim(`  Fix these issues, then run 'pan done ${issueId}' again.`));
        console.error(chalk.dim('  Use --force to skip checks.'));
        console.error('');
        process.exit(1);
        return;
      }

      try {
        const { stdout: postDirty } = await execAsync(
          'git status --porcelain .pan/',
          { cwd: workspacePath, encoding: 'utf-8' }
        );
        if (postDirty.trim()) {
          await execAsync('git add .pan/', { cwd: workspacePath });
          await execAsync('git commit -m "chore: sync planning artifacts"', { cwd: workspacePath });
        }
      } catch { /* non-fatal */ }
    }
  }

  const spinner = ora('Marking work as done...').start();

  try {
    // Step 0: Rebase onto target branch + push.
    //
    // Absorbing the rebase into `pan done` eliminates the multi-step
    // orchestration burden that was causing agents to stop partway through
    // the submit flow. An agent now has exactly one command to run; this
    // step handles the fetch/rebase/push that agents previously had to
    // perform manually before calling `pan done`.
    //
    // Planning-artifact conflicts (`.planning/*`) are auto-resolved with
    // `--ours`. Any other conflicts abort the rebase and surface a clear
    // error; the agent must resolve them and re-run `pan done`.
    {
      const { getAgentState } = await import('../../lib/agents.js');
      const rebaseAgentState = getAgentState(agentId);
      const rebaseWorkspacePath = rebaseAgentState?.workspace;

      if (rebaseWorkspacePath && existsSync(rebaseWorkspacePath)) {
        const { ensureMergeSetForIssue } = await import('../../lib/merge-set.js');
        const { rebaseAndPushRepos } = await import('../../lib/rebase-helper.js');
        const preMergeSet = ensureMergeSetForIssue(issueId);

        if (preMergeSet && preMergeSet.repos.length > 0) {
          spinner.text = 'Rebasing onto target branch and pushing...';
          const rebaseResult = await rebaseAndPushRepos(rebaseWorkspacePath, preMergeSet);

          if (!rebaseResult.success) {
            const failure = rebaseResult.firstFailure!;
            spinner.fail(`Rebase failed in ${failure.repoKey}`);
            console.error('');
            if (failure.conflictFiles?.length) {
              console.error(chalk.red(`Rebase conflicts in non-planning files:`));
              for (const file of failure.conflictFiles) {
                console.error(chalk.red(`  - ${file}`));
              }
              console.error('');
              console.error(chalk.dim('Resolve the conflicts manually, commit, then re-run:'));
              console.error(chalk.dim(`  pan done ${issueId}`));
            } else {
              console.error(chalk.red(failure.message || 'Unknown rebase error'));
            }
            console.error('');
            process.exit(1);
          }

          const rebased = rebaseResult.results.filter(r => r.outcome === 'rebased');
          if (rebased.length > 0) {
            console.log(chalk.green(`  ✓ Rebased and pushed ${rebased.length} repo(s)`));
          } else {
            console.log(chalk.dim('  Branch already current with target — pushed any local commits'));
          }
        }
      }
    }

    let trackerUpdated = false;
    let shadowModeActive = false;
    const isGitHubIssue = issueId.startsWith('PAN-');

    // Step 1: Update status (either tracker or shadow)
    const skipTrackerUpdate = await shouldSkipTrackerUpdate(issueId);

    if (skipTrackerUpdate) {
      shadowModeActive = true;
      spinner.text = 'Updating shadow state...';
      await updateShadowState(issueId, 'in_review', 'pan done');
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
    } else {
      const apiKey = Effect.runSync(getLinearApiKey());
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

    // Step 2: Create review artifacts immediately and persist merge-set state.
    const { getAgentState, saveAgentState } = await import('../../lib/agents.js');
    const existingState = getAgentState(agentId);
    const workspacePath = existingState?.workspace;

    if (!workspacePath || !existsSync(workspacePath)) {
      throw new Error(`Workspace not found for ${issueId}; cannot create review artifact set`);
    }

    spinner.text = 'Creating review artifacts...';
    const { createReviewArtifactsForIssue } = await import('../../lib/review-artifacts.js');
    const { setReviewStatus } = await import('../../lib/review-status.js');
    const artifactResult = await createReviewArtifactsForIssue(issueId, workspacePath);
    const primaryArtifact = artifactResult.mergeSet?.repos.find(repo => !!repo.artifactUrl);
    if (primaryArtifact?.artifactUrl) {
      setReviewStatus(issueId, { prUrl: primaryArtifact.artifactUrl });
    }

    const createdArtifacts = artifactResult.artifacts.filter(artifact => !artifact.skipped && artifact.url);
    if (createdArtifacts.length > 0) {
      console.log(chalk.green(`  ✓ Created review artifact set (${createdArtifacts.length} repo${createdArtifacts.length === 1 ? '' : 's'})`));
    } else {
      console.log(chalk.yellow('  ⚠ No changed repos detected for review artifact creation'));
    }

    // Step 3: Update agent state to stopped (so it appears in dashboard agents list).
    // The completed marker and review artifact state represent standby/review handoff;
    // state.json now keeps only stable role identity, not transient phases.
    if (existingState) {
      existingState.status = 'stopped';
      existingState.stoppedByUser = true;
      existingState.lastActivity = new Date().toISOString();
      saveAgentState(existingState);
    }
    // Also update runtime state to idle
    saveAgentRuntimeState(agentId, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
    });

    // Step 4: Write completion marker
    mkdirSync(join(AGENTS_DIR, agentId), { recursive: true });
    const completedFile = join(AGENTS_DIR, agentId, 'completed');
    // Re-runs of `pan done` (e.g. after a review feedback round) must reset the
    // cloister's processed-marker, otherwise checkCompletionMarkers() at
    // service.ts:670 sees `completed.processed` exist and skips the new trigger.
    const processedMarker = join(AGENTS_DIR, agentId, 'completed.processed');
    if (existsSync(processedMarker)) {
      try { unlinkSync(processedMarker); } catch {}
    }
    writeFileSync(completedFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      trackerUpdated,
      comment: options.comment,
    }));

    // Append 'end' session entry to workspace continue state.
    try {
      const continueState = readWorkspaceContinue(workspacePath);
      if (continueState) {
        const now = new Date().toISOString();
        writeWorkspaceContinue(workspacePath, {
          ...continueState,
          sessionHistory: [
            ...continueState.sessionHistory,
            {
              timestamp: now,
              reason: 'end',
              note: options.comment || 'Agent signaled work complete',
            },
          ],
        });
      }
    } catch (continueErr: any) {
      console.warn(`[pan done] Failed to append end entry to continue state (non-fatal): ${continueErr?.message ?? continueErr}`);
    }

    // Step 4b: Guard against actually-merged issues (e.g. merge completed in
    // background while agent was finishing up). Review status is cached state and
    // can be stale after re-submission, so verify git ancestry before skipping.
    const { getReviewStatus } = await import('../../lib/review-status.js');
    const currentStatus = getReviewStatus(issueId);
    if (currentStatus?.mergeStatus === 'merged') {
      const actuallyMerged = await isMergeSetMergedIntoTargets(workspacePath, artifactResult.mergeSet);
      if (actuallyMerged) {
        spinner.succeed(`Work complete: ${issueId} (already merged — skipping review pipeline)`);
        console.log(chalk.green(`  ✓ Issue was already merged — no review pipeline triggered`));
        console.log('');
        return;
      }

      console.log(chalk.yellow(`  ⚠ Stored merge status for ${issueId} was stale; re-running review pipeline.`));
    }

    // Step 4c: Guard against no-op re-submission. If review already passed and
    // HEAD hasn't changed since the review snapshot, skip re-review entirely.
    // This prevents agents from accidentally cycling the pipeline after approval.
    if (currentStatus?.reviewStatus === 'passed' && currentStatus?.reviewedAtCommit) {
      const { getWorkspaceGitInfo } = await import('../../lib/git-utils.js');
      try {
        const { HEAD } = await getWorkspaceGitInfo(workspacePath);
        if (HEAD === currentStatus.reviewedAtCommit) {
          spinner.succeed(`Work complete: ${issueId} (review already passed at ${HEAD.slice(0, 8)} — no new commits, skipping re-review)`);
          console.log(chalk.green(`  ✓ Review already passed and no new commits detected. Pipeline continues normally.`));
          console.log('');
          return;
        }
        console.log(chalk.yellow(`  ⚠ New commits since review passed (${currentStatus.reviewedAtCommit.slice(0, 8)} → ${HEAD.slice(0, 8)}). Re-running review pipeline.`));
      } catch {
        // Git info unavailable — proceed with normal flow rather than blocking
      }
    }

    // Atomically initialize review status in SQLite so the pipeline
    // can proceed even if the dashboard is offline. The HTTP trigger below is
    // an optimization — deacon will pick this up if it fails.
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      verificationStatus: 'pending',
      verificationCycleCount: 0,
      autoRequeueCount: 0,
    });

    await restoreTrackedBeadsExport(workspacePath);

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

    console.log(chalk.dim('Ready for review. When review passes, click MERGE in the dashboard.'));
    console.log('');

    // Auto-trigger review & test (respecting circuit breaker)
    try {
      const { getDashboardApiUrl } = await import('../../lib/config.js');
      const dashboardUrl = getDashboardApiUrl();

      // Check if dashboard is running. Use fetch() so https:// URLs work
      // (e.g. when DASHBOARD_URL points at https://pan.localhost via Traefik).
      const checkDashboard = async (): Promise<boolean> => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${dashboardUrl}/api/health`, { method: 'GET', signal: controller.signal });
          clearTimeout(timer);
          return res.status === 200;
        } catch {
          return false;
        }
      };

      const dashboardRunning = await checkDashboard();

      if (dashboardRunning) {
        console.log(chalk.dim('Auto-triggering review & test...'));

        const postJson = async (path: string): Promise<any> => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const res = await fetch(`${dashboardUrl}${path}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
              signal: controller.signal,
            });
            clearTimeout(timer);
            try {
              return await res.json();
            } catch {
              return { success: false, error: 'Invalid response' };
            }
          } catch (err: any) {
            clearTimeout(timer);
            throw err;
          }
        };

        let result = await postJson(`/api/review/${issueId}/trigger`);

        // Self-healing: if issue was previously reviewed (blocked/failed) or merged, auto-reset and retry.
        // This is the normal flow when a work agent fixes review issues and re-signals done.
        if (!result.success && (result.alreadyMerged || result.alreadyReviewed)) {
          const reason = result.alreadyMerged ? 'previously merged' : 'prior review blocked/failed';
          console.log(chalk.yellow(`  ⚠ Issue was ${reason}. Resetting specialist states for re-review...`));

          const resetResult = await postJson(`/api/review/${issueId}/reset`);
          if (resetResult.success) {
            console.log(chalk.green(`  ✓ Specialist states reset`));
            // Retry review
            result = await postJson(`/api/review/${issueId}/trigger`);
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

    await restoreTrackedBeadsExport(workspacePath);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await restoreTrackedBeadsExport(workspacePath);

  } catch (error: any) {
    spinner.fail(error.message);
    process.exit(1);
  }
}
