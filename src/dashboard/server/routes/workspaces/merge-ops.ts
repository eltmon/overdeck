/**
 * Merge-ops module — extracted from routes/workspaces.ts (B / wave 2, seam 4a).
 *
 * The merge execution engine: triggerMerge() + its exclusive helpers
 * (dequeueNextMerge, isBranchAlreadyRebased, ensureWorkAgentReadyForMerge) and
 * the TriggerMergeResult contract. Contains NO HTTP routes — the merge/approve
 * routes live in approve-ops.ts and call triggerMerge(); workspaces.ts still
 * registers triggerMerge via setMergeQueueTriggerHandler().
 *
 * Shared singletons (review-status wrapper, pending-ops cluster, ensurePRExists,
 * project path, workspace info) stay owned by ../workspaces.js.
 */


import { exec, execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Option } from 'effect';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import { resolveProjectFromIssueSync, findProjectByTeamSync } from '../../../../lib/projects.js';
import { getReviewStatusSync, markWorkspaceStuck } from '../../../../lib/review-status.js';
import { gitPush, MainDivergedError } from '../../../../lib/git/operations.js';
import { listGitOperationsSync } from '../../../../lib/git-activity.js';
import { getCachedConflictGateMergeability } from '../../../../lib/cloister/conflict-gate.js';
import { restoreTrackedBeadsExport } from '../../../../lib/beads-restore.js';
import { messageAgent, getAgentState, spawnAgent } from '../../../../lib/agents.js';
import { getWorkAgentLifecycleStateSync } from '../../../../lib/work-agent-lifecycle.js';
import { syncMainIntoWorkspace } from '../../../../lib/cloister/merge-agent.js';
import { runVerificationForIssue } from '../../../../lib/cloister/verification-runner.js';
import { loadConfigSync } from '../../../../lib/config.js';
import {
  enqueueMerge,
  getCurrentMerge,
  markMergeProcessing,
  dequeueMerge,
} from '../../../../lib/overdeck/merge.js';
import { _serverManagedMerges } from '../specialists.js';
import {
  setReviewStatus,
  setPendingOperation,
  completePendingOperation,
  ensurePRExists,
  getProjectPath,
  getWorkspaceInfoForIssue,
  reconcileGitHubMergeStatus,
  type WorkspaceInfo,
} from '../workspaces.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Safe `.message` read for caught values of unknown shape. */
const errorMessage = (e: unknown): string | undefined => e instanceof Error ? e.message : undefined;


async function ensureWorkAgentReadyForMerge(
  issueId: string,
  workspacePath: string,
  rebaseMsg: string,
): Promise<{ recovered: boolean; agentId: string; detail: string }> {
  const agentId = `agent-${issueId.toLowerCase()}`;
  const lifecycle = getWorkAgentLifecycleStateSync(agentId);

  if (lifecycle.hasLiveTmuxSession) {
    await messageAgent(agentId, rebaseMsg);
    return { recovered: true, agentId, detail: 'Work agent already running; sent merge preparation request.' };
  }

  const agentState = await Effect.runPromise(getAgentState(agentId));
  if (agentState) {
    try {
      await messageAgent(agentId, rebaseMsg);
      const updatedLifecycle = getWorkAgentLifecycleStateSync(agentId);
      return {
        recovered: true,
        agentId,
        detail: updatedLifecycle.canResumeSession
          ? 'Resumed work agent and sent merge preparation request.'
          : 'Restarted work agent and sent merge preparation request.',
      };
    } catch (err: unknown) {
      if (!lifecycle.canStartFresh) {
        throw err;
      }
    }
  }

  if (!lifecycle.canStartFresh) {
    throw new Error(lifecycle.reason || `Work agent ${agentId} cannot be resumed or started for merge preparation.`);
  }

  const state = await spawnAgent({
    issueId,
    workspace: workspacePath,
    role: 'work',
    prompt: rebaseMsg,
  });

  return {
    recovered: true,
    agentId,
    detail: `Started fresh work agent ${state.id} and sent merge preparation request.`,
  };
}

export async function isBranchAlreadyRebased(
  workspacePath: string,
  branchName: string,
  targetBranch: string,
): Promise<{ alreadyRebased: boolean; currentHead?: string }> {
  try {
    await Promise.all([
      execFileAsync('git', ['fetch', 'origin', targetBranch], { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 }),
      execFileAsync('git', ['fetch', 'origin', branchName], { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 }),
    ]);
    await execFileAsync(
      'git',
      ['merge-base', '--is-ancestor', `origin/${targetBranch}`, `origin/${branchName}`],
      { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
    );
    const { stdout: currentHead } = await execFileAsync(
      'git',
      ['rev-parse', `origin/${branchName}`],
      { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
    );
    return { alreadyRebased: true, currentHead: currentHead.trim() };
  } catch {
    return { alreadyRebased: false };
  }
}

export interface TriggerMergeResult {
  success: boolean;
  statusCode: number;
  error?: string;
  message?: string;
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  prUrl?: string;
  remote?: boolean;
  repos?: Array<{ repo: string; success: boolean; message: string; testsStatus?: string }>;
  testsStatus?: string;
  note?: string;
  mergeResult?: unknown;
}

function dequeueNextMerge(projectKey: string, completedIssueId?: string): void {
  const nextIssueId = dequeueMerge(projectKey, completedIssueId);
  if (nextIssueId) {
    console.log(`[merge] Dequeuing next merge: ${nextIssueId}`);
    triggerMerge(nextIssueId).catch(err =>
      console.error(`[merge] Queue error for ${nextIssueId}: ${err}`)
    );
  }
}

export async function triggerMerge(issueId: string): Promise<TriggerMergeResult> {
  const reviewStatus = getReviewStatusSync(issueId);
  if (!reviewStatus?.readyForMerge) {
    return {
      success: false,
      statusCode: 400,
      error: 'Cannot merge: review and tests have not passed yet',
      reviewStatus: reviewStatus?.reviewStatus || 'pending',
      testStatus: reviewStatus?.testStatus || 'pending',
    };
  }

  // NOTE: Commit status reporting moved to AFTER rebase — see below.
  // The rebase changes the HEAD SHA, so statuses must be reported on the new commit.
  if (false && reviewStatus?.prUrl) {
    try {
      const { isGitHubAppConfigured, reportCommitStatus } = await import('../../../lib/github-app.js');
      if (isGitHubAppConfigured()) {
        const prMatch = reviewStatus!.prUrl!.match(/\/pull\/(\d+)/);
        if (prMatch) {
          const { stdout } = await execAsync(
            `gh pr view ${prMatch![1]} --json headRefOid --jq .headRefOid`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          const sha = stdout.trim();
          if (sha) {
            await reportCommitStatus('eltmon', 'overdeck', sha, 'success', 'overdeck/review', 'Review passed');
            await reportCommitStatus('eltmon', 'overdeck', sha, 'success', 'overdeck/test', 'Tests passed');
            console.log(`[merge] Reported commit statuses for ${issueId} (${sha.slice(0, 8)})`);
          }
        }
      }
    } catch (err: unknown) {
      console.warn(`[merge] Failed to report commit statuses: ${errorMessage(err)}`);
    }
  }

  if (reviewStatus?.mergeStatus === 'merging') {
    const pendingOp = getPendingOperation(issueId);
    const activelyMerging = pendingOp?.type === 'merge' && pendingOp?.status === 'running';
    if (activelyMerging) {
      return {
        success: false,
        statusCode: 400,
        error: 'Merge already in progress',
        mergeStatus: 'merging',
      };
    }
    console.log(
      `[merge] Clearing stuck mergeStatus for ${issueId} (pending op: ${pendingOp?.status ?? 'absent'})`
    );
    setReviewStatus(issueId, { mergeStatus: undefined });
  }

  if (reviewStatus?.mergeStatus === 'merged') {
    return { success: false, statusCode: 400, error: 'Already merged', mergeStatus: 'merged' };
  }

  const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();

  // Serialize merges per project via persistent SQLite queue (PAN-632).
  // Survives server restarts — no more lost queues.
  const projectKey = issuePrefix.toLowerCase();
  const normalizedId = issueId.toUpperCase();
  const currentlyMerging = getCurrentMerge(projectKey);
  if (currentlyMerging && currentlyMerging !== normalizedId) {
    // Another merge is in progress — queue this one
    const position = enqueueMerge(projectKey, normalizedId);
    setReviewStatus(issueId, { mergeStatus: 'queued', mergeStep: 'queued' });
    console.log(`[merge] Queued ${issueId} (position ${position}, waiting for ${currentlyMerging})`);
    return {
      success: true,
      statusCode: 200,
      message: `Queued for merge (position ${position}, waiting for ${currentlyMerging})`,
      mergeStatus: 'queued',
    };
  }
  // Mark as processing IMMEDIATELY — before any async work — to prevent race conditions.
  // SQLite write is atomic — no window for concurrent calls to both pass the check.
  enqueueMerge(projectKey, normalizedId);
  markMergeProcessing(projectKey, normalizedId);

  const workspaceInfo = getWorkspaceInfoForIssue(issueId);

  // Use the actual resolved workspace path (handles legacy feature-484 naming)
  const workspacePath = (!workspaceInfo.isRemote && workspaceInfo.localPath)
    ? workspaceInfo.localPath
    : join(projectPath, 'workspaces', `feature-${issueLower}`);
  const workspaceDirName = basename(workspacePath);
  const branchName = workspaceDirName.startsWith('feature-')
    ? `feature/${workspaceDirName.slice('feature-'.length)}`
    : `feature/${issueLower}`;

  setReviewStatus(issueId, { mergeStatus: 'merging', mergeStep: 'validating-pr' });

  const normalizedMergeId = issueId.toUpperCase();
  _serverManagedMerges.add(normalizedMergeId);
  setPendingOperation(issueId, 'merge');
  let queueAdvanced = false;

  const advanceQueue = (): void => {
    if (queueAdvanced) return;
    queueAdvanced = true;
    _serverManagedMerges.delete(normalizedMergeId);
    dequeueNextMerge(projectKey, normalizedId);
  };

  try {
    if (workspaceInfo.isRemote && workspaceInfo.vmName) {
      console.log(
        `[merge] Remote workspace detected for ${issueId}, using review artifact merge...`
      );
      const { getMergeSetSync, ensureMergeSetForIssueSync } = await import('../../../lib/merge-set.js');
      const { getForgeAdapter } = await import('../../../lib/forge.js');
      const remoteMergeSet = getMergeSetSync(issueId) || ensureMergeSetForIssueSync(issueId);
      const remotePrimaryRepo = remoteMergeSet?.repos[0];
      const remoteTargetBranch = remotePrimaryRepo?.targetBranch || 'main';
      const remoteForge = remotePrimaryRepo?.forge || 'github';

      const prResult = await ensurePRExists(issueId, { targetBranch: remoteTargetBranch });
      if (!prResult.prUrl) {
        const error = `Failed to create PR: ${prResult.error || 'Unknown error'}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }
      const artifactUrl = remotePrimaryRepo?.artifactUrl || prResult.prUrl;
      const artifactId = remotePrimaryRepo?.artifactId;

      try {
        console.log(`[merge] Merging ${remoteForge} review artifact for ${issueId}...`);
        await getForgeAdapter(remoteForge).mergeReviewArtifact({
          forge: remoteForge,
          url: artifactUrl,
          id: artifactId,
          method: 'squash',
        });

        setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
        completePendingOperation(issueId, null);

        const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
        await postMergeLifecycle(issueId, projectPath);

        const remotePrNumber = prResult.prUrl.match(/\/pull\/(\d+)/)?.[1] ?? '?';
        return {
          success: true,
          statusCode: 200,
          message: `Successfully merged PR #${remotePrNumber} for ${issueId}`,
          mergeStatus: 'merged',
          prUrl: prResult.prUrl,
          remote: true,
        };
      } catch (remoteErr: unknown) {
        const mergeErrorMessage = `Remote merge failed: ${errorMessage(remoteErr)}`;
        console.error(`[merge] Remote merge failed for ${issueId}:`, remoteErr);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: mergeErrorMessage });
        completePendingOperation(issueId, errorMessage(remoteErr));
        return {
          success: false,
          statusCode: 500,
          error: mergeErrorMessage,
        };
      }
    }

    if (!existsSync(workspacePath)) {
      completePendingOperation(issueId, 'Workspace does not exist');
      return { success: false, statusCode: 400, error: 'Workspace does not exist' };
    }

    const projectConfig = findProjectByTeamSync(issuePrefix);
    const isPolyrepo = projectConfig?.workspace?.type === 'polyrepo';

    if (isPolyrepo && projectConfig?.workspace?.repos) {
      console.log(`[merge] Polyrepo detected for ${issueId}, coordinating merge set...`);
      const { getMergeSetSync, ensureMergeSetForIssueSync, upsertMergeSetSync, withRepoStateSync } = await import('../../../lib/merge-set.js');
      const { runQualityGates } = await import('../../../lib/cloister/validation.js');
      const { getForgeAdapter } = await import('../../../lib/forge.js');
      const { messageAgent } = await import('../../../lib/agents.js');
      let mergeSet = getMergeSetSync(issueId) || ensureMergeSetForIssueSync(issueId);
      if (!mergeSet) {
        const error = `No merge set found for ${issueId}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      const activeRepos = mergeSet.repos
        .filter(repo => repo.mergeStatus !== 'skipped' && !!repo.artifactUrl)
        .sort((a, b) => a.mergeOrder - b.mergeOrder);

      if (activeRepos.length === 0) {
        const error = `No changed repos are marked ready for coordinated merge in ${issueId}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      const agentId = `agent-${issueId.toLowerCase()}`;
      if (!await Effect.runPromise(sessionExists(agentId))) {
        const error = `Work agent ${agentId} is not running. Polyrepo merge requires the work agent to rebase every affected repo and push.`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      mergeSet = {
        ...mergeSet,
        status: 'merging',
        updatedAt: new Date().toISOString(),
      };
      upsertMergeSetSync(mergeSet);

      const mergeResults: Array<{
        repo: string;
        success: boolean;
        message: string;
        testsStatus?: string;
      }> = [];
      const repoHeadsBefore = new Map<string, string>();

      for (const repo of activeRepos) {
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        if (!existsSync(repoWorkspacePath) || !existsSync(join(repoWorkspacePath, '.git'))) {
          const error = `Workspace repo ${repo.repoKey} is missing`;
          mergeResults.push({ repo: repo.repoKey, success: false, message: error });
          continue;
        }

        const { stdout: headBefore } = await execAsync(
          `git rev-parse origin/${repo.sourceBranch} 2>/dev/null || echo NONE`,
          { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 10000 }
        );
        repoHeadsBefore.set(repo.repoKey, headBefore.trim());
        mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { rebaseStatus: 'requested' });
      }
      upsertMergeSetSync(mergeSet);

      if (mergeResults.some(result => !result.success)) {
        const failedDetails = mergeResults.filter(r => !r.success).map(r => `${r.repo}: ${r.message}`).join('; ');
        const error = `Polyrepo merge prerequisites failed for ${issueId}: ${failedDetails}`;
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error, repos: mergeResults };
      }

      const rebaseInstructions = activeRepos.map((repo, index) => (
        `${index + 1}. cd ${repo.repoKey}\n   git fetch origin ${repo.targetBranch}\n   git rebase origin/${repo.targetBranch}\n   git push --force-with-lease`
      )).join('\n');
      const rebaseMsg = `MERGE REQUESTED: The human has clicked MERGE for ${issueId}. Rebase and push every affected repo in this merge set:\n\n${rebaseInstructions}\n\nResolve any conflicts in the workspaces above, complete every rebase, and push all affected branches. Do NOT merge PRs/MRs yourself.`;
      await messageAgent(agentId, rebaseMsg);

      const REBASE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — complex polyrepo rebases need time for conflict resolution
      const POLL_INTERVAL_MS = 5000;
      const pushedRepos = new Set<string>();
      const rebaseStart = Date.now();

      while (Date.now() - rebaseStart < REBASE_TIMEOUT_MS && pushedRepos.size < activeRepos.length) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

        for (const repo of activeRepos) {
          if (pushedRepos.has(repo.repoKey)) continue;

          const repoWorkspacePath = join(workspacePath, repo.repoKey);
          try {
            await execAsync('git fetch origin', { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 15000 });
            const { stdout: headNow } = await execAsync(
              `git rev-parse origin/${repo.sourceBranch}`,
              { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 5000 }
            );
            if (headNow.trim() !== repoHeadsBefore.get(repo.repoKey)) {
              pushedRepos.add(repo.repoKey);
              mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { rebaseStatus: 'passed' });
              upsertMergeSetSync(mergeSet);
            }
          } catch {
            // Retry until timeout or agent exit.
          }
        }

        if (!await Effect.runPromise(sessionExists(agentId))) break;
      }

      if (pushedRepos.size !== activeRepos.length) {
        const remaining = activeRepos
          .filter(repo => !pushedRepos.has(repo.repoKey))
          .map(repo => repo.repoKey);
        const agentRunning = await Effect.runPromise(sessionExists(agentId));
        const error = !agentRunning
          ? `Work agent ${agentId} stopped before completing polyrepo rebases for ${remaining.join(', ')}`
          : `Work agent did not push rebased branches for ${remaining.join(', ')} within ${REBASE_TIMEOUT_MS / 60000} minutes`;
        for (const repoKey of remaining) {
          mergeSet = withRepoStateSync(mergeSet, repoKey, { rebaseStatus: 'failed' });
        }
        upsertMergeSetSync(mergeSet);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error };
      }

      setReviewStatus(issueId, { mergeStatus: 'verifying', mergeNotes: undefined });
      for (const repo of activeRepos) {
        const repoConfig = projectConfig.workspace.repos.find(configRepo => configRepo.name === repo.repoKey);
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        const gateIdentifiers = new Set<string>([
          repo.repoKey,
          repoConfig?.path || '',
        ].filter(Boolean));
        const gates = Object.fromEntries(
          Object.entries(projectConfig.quality_gates || {}).filter(
            ([, gate]) => gate.path && gateIdentifiers.has(gate.path)
          )
        );

        mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { verificationStatus: 'running' });
        upsertMergeSetSync(mergeSet);

        if (Object.keys(gates).length === 0) {
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { verificationStatus: 'skipped' });
          upsertMergeSetSync(mergeSet);
          continue;
        }

        const gateResults = await Effect.runPromise(runQualityGates(gates, repoWorkspacePath, 'pre_push'));
        const failedGate = gateResults.find(result => !result.passed && result.required !== false);
        if (failedGate) {
          const error = `Polyrepo post-rebase verification failed for ${repo.repoKey} at ${failedGate.name}`;
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { verificationStatus: 'failed' });
          upsertMergeSetSync(mergeSet);
          setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
          completePendingOperation(issueId, error);
          return { success: false, statusCode: 500, error };
        }

        mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { verificationStatus: 'passed' });
        upsertMergeSetSync(mergeSet);
      }

      setReviewStatus(issueId, { mergeStatus: 'merging' });
      for (const repo of activeRepos) {
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        try {
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'merging' });
          upsertMergeSetSync(mergeSet);
          await getForgeAdapter(repo.forge).mergeReviewArtifact({
            forge: repo.forge,
            url: repo.artifactUrl,
            id: repo.artifactId,
            cwd: repoWorkspacePath,
            method: 'squash',
          });
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'merged' });
          upsertMergeSetSync(mergeSet);
          mergeResults.push({
            repo: repo.repoKey,
            success: true,
            message: `Merged via ${repo.forge}`,
          });
        } catch (mergeErr: unknown) {
          const error = errorMessage(mergeErr) || 'Artifact merge failed';
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'failed' });
          upsertMergeSetSync(mergeSet);
          mergeResults.push({ repo: repo.repoKey, success: false, message: error });
          break;
        }
      }

      const failedRepos = mergeResults.filter(r => !r.success);

      if (failedRepos.length > 0) {
        const error = `Polyrepo merge failed for: ${failedRepos
          .map(r => `${r.repo} (${r.message})`)
          .join(', ')}`;
        mergeSet = {
          ...mergeSet,
          status: 'failed',
          updatedAt: new Date().toISOString(),
        };
        upsertMergeSetSync(mergeSet);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error, repos: mergeResults };
      }

      mergeSet = {
        ...mergeSet,
        status: 'merged',
        updatedAt: new Date().toISOString(),
      };
      upsertMergeSetSync(mergeSet);
      setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
      completePendingOperation(issueId, null);

      const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
      advanceQueue();
      await postMergeLifecycle(issueId, projectPath);

      return {
        success: true,
        statusCode: 200,
        message: `Polyrepo merge complete for ${issueId}`,
        mergeStatus: 'merged',
        repos: mergeResults,
      };
    }

    // Monorepo / single-repo merge: PR-based flow
    const { getMergeSetSync, ensureMergeSetForIssueSync } = await import('../../../lib/merge-set.js');
    const { getForgeAdapter } = await import('../../../lib/forge.js');
    const monorepoMergeSet = getMergeSetSync(issueId) || ensureMergeSetForIssueSync(issueId);
    const primaryRepo = monorepoMergeSet?.repos[0];
    const targetBranch = primaryRepo?.targetBranch || 'main';
    const primaryForge = primaryRepo?.forge || 'github';

    // Step 1: Ensure PR exists (creates if needed)
    const prResult = await ensurePRExists(issueId, { cwd: workspacePath, branchName, targetBranch });
    if (!prResult.prUrl) {
      const error = `Failed to create PR: ${prResult.error || 'Unknown error'}`;
      setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: 400, error };
    }

    const artifactUrl = primaryRepo?.artifactUrl || prResult.prUrl;
    const artifactId = primaryRepo?.artifactId;
    const githubPrRef = primaryForge === 'github' ? parseGitHubPullRequestUrl(artifactUrl) : null;
    const prNumber = githubPrRef ? String(githubPrRef.number) : undefined;
    if (primaryForge === 'github' && !prNumber) {
      const error = `Could not parse PR number from URL: ${artifactUrl}`;
      setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: 400, error };
    }

    // Step 1b: Validate that the PR is still OPEN before rebasing/merging.
    // A cancel-flow or manual `gh pr close` can leave stale `prUrl` pointing at a
    // CLOSED PR while Overdeck state still shows readyForMerge=true. Without this
    // check, the rebase + merge pipeline runs against a dead PR and dies silently
    // inside `gh pr merge` (see PAN-509 cancel-flow divergence).
    if (githubPrRef) {
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../lib/github-app.js');
        if (isGitHubAppConfigured()) {
          const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
          if (prState.state !== 'OPEN' && !prState.merged) {
            const error = `PR #${githubPrRef.number} is ${prState.state} (not OPEN). Overdeck state is out of sync — likely a cancel-flow left a stale prUrl. Re-open the work agent to create a fresh PR, or reset review state.`;
            console.error(`[merge] ${error}`);
            setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          // Defense-in-depth: refuse to merge when required CI checks are failing on the
          // PR's current HEAD. Without this gate, we attempt a rebase and `gh pr merge`
          // against a branch whose CI is red; branch protection blocks the merge and we
          // get a generic error. Surface the real blocker (failing CI) up-front so the
          // work-agent can fix it instead of us churning the queue. See PAN-611/PAN-544
          // (Run 7): feature branches had gitignored source + stale bun.lock; local
          // verification passed but CI failed — the divergence was invisible until merge.
          if (prState.checksFailed && !prState.merged) {
            const error = `GitHub PR #${githubPrRef.number} has failing required checks on HEAD ${prState.headSha.slice(0, 8)}. Fix CI before merging — see ${prState.url || 'the PR page'} for details.`;
            console.error(`[merge] ${error}`);
            setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          // Defense-in-depth: refuse to merge when the PR is CONFLICTING with its base.
          // Without this, a clean-CI-but-conflicting PR sails into the rebase/retry loop in
          // forge.ts and churns for minutes before a generic timeout. The mergeable/
          // mergeableState fields are already on prState from getPullRequestState. Writing a
          // merge_conflict blocker back into review status drops the row out of the
          // "Awaiting Merge" queue and into "Blocked from Merge" with a clear reason even if
          // the GitHub webhook that normally populates blockerReasons was delayed or dropped
          // (the reactive-only gap that let PAN-1574 show a live MERGE button). PAN-1619-followup.
          if ((prState.mergeable === false || prState.mergeableState === 'dirty') && !prState.merged) {
            const error = `GitHub PR #${githubPrRef.number} is CONFLICTING with ${prState.baseBranch}. Resolve conflicts before merging — see ${prState.url || 'the PR page'}.`;
            console.error(`[merge] ${error}`);
            setReviewStatus(issueId, {
              mergeStatus: 'failed',
              readyForMerge: false,
              mergeNotes: error,
              blockerReasons: [{
                type: 'merge_conflict',
                summary: `Conflicts with ${prState.baseBranch}`,
                detectedAt: new Date().toISOString(),
              }],
            });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          if (prState.merged) {
            console.log(`[merge] PR #${githubPrRef.number} for ${issueId} is already merged — running post-merge lifecycle`);
            setReviewStatus(issueId, { mergeStatus: 'merged', mergeNotes: undefined, readyForMerge: false });
            completePendingOperation(issueId, null);
            const { postMergeLifecycle } = await import('../../../lib/cloister/merge-agent.js');
            await postMergeLifecycle(issueId, projectPath, branchName);
            return {
              success: true,
              statusCode: 200,
              message: `PR #${githubPrRef.number} for ${issueId} was already merged`,
              mergeStatus: 'merged',
              prUrl: prResult.prUrl,
            };
          }
        }
      } catch (prStateErr: unknown) {
        console.warn(`[merge] Pre-merge PR state check failed for ${issueId}: ${errorMessage(prStateErr)} — proceeding (check is best-effort)`);
      }
    }

    // Step 2: Tell the WORK AGENT to rebase onto the target branch and push.
    // The server coordinates; the work agent owns all code-changing git operations.
    const { postMergeLifecycle } = await import(
      '../../../lib/cloister/merge-agent.js'
    );
    const agentId = `agent-${issueId.toLowerCase()}`;
    const rebaseMsg = `MERGE REQUESTED: The human has clicked MERGE for ${issueId}. Please rebase onto ${targetBranch} and push:\n\n1. git fetch origin ${targetBranch}\n2. git rebase origin/${targetBranch}\n3. If conflicts: resolve them, git add, git rebase --continue\n4. git push --force-with-lease\n\nAfter pushing, the server will handle verification and merge automatically. Do NOT run gh pr merge yourself.`;

    setReviewStatus(issueId, { mergeStep: 'rebasing' });
    console.log(`[merge] Rebasing ${branchName} onto ${targetBranch} for ${issueId} (agent=${await Effect.runPromise(sessionExists(agentId)) ? 'running' : 'stopped'})...`);

    let rebaseResult: { success: boolean; reason?: string; conflictFiles?: string[]; newHead?: string };

    // Pre-check: if origin/<branch> already contains origin/<target>, the branch
    // is already rebased — no rebase or push is needed.
    const { alreadyRebased, currentHead } = await isBranchAlreadyRebased(workspacePath, branchName, targetBranch);

    if (alreadyRebased && currentHead) {
      console.log(`[merge] ${branchName} already contains origin/${targetBranch} — skipping rebase request for ${issueId}`);
      rebaseResult = { success: true, newHead: currentHead };
    } else {
      try {
        const recovery = await ensureWorkAgentReadyForMerge(issueId, workspacePath, rebaseMsg);
        console.log(`[merge] ${recovery.detail}`);

        // Poll for the push: check if remote HEAD changed
        const { stdout: headBefore } = await execAsync(
          `git rev-parse origin/${branchName} 2>/dev/null || echo NONE`,
          { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
        );

        const REBASE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — complex rebases with conflicts need time
        const POLL_INTERVAL_MS = 5000;
        const startTime = Date.now();
        let newHead: string | null = null;

        while (Date.now() - startTime < REBASE_TIMEOUT_MS) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          try {
            await execAsync('git fetch origin', { cwd: workspacePath, encoding: 'utf-8', timeout: 15000 });
            const { stdout: headNow } = await execAsync(
              `git rev-parse origin/${branchName}`,
              { cwd: workspacePath, encoding: 'utf-8', timeout: 5000 }
            );
            if (headNow.trim() !== headBefore.trim()) {
              newHead = headNow.trim();
              console.log(`[merge] Work agent pushed rebased branch for ${issueId} (new HEAD: ${newHead.slice(0, 8)})`);
              break;
            }
          } catch { /* fetch failed, retry */ }

          if (!await Effect.runPromise(sessionExists(agentId))) {
            console.log(`[merge] Work agent ${agentId} stopped during rebase`);
            break;
          }
        }

        if (newHead) {
          rebaseResult = { success: true, newHead };
        } else if (!await Effect.runPromise(sessionExists(agentId))) {
          rebaseResult = {
            success: false,
            reason: `Work agent ${agentId} stopped before completing the rebase onto ${targetBranch}`,
          };
        } else {
          rebaseResult = { success: false, reason: `Work agent did not push the rebased branch within ${REBASE_TIMEOUT_MS / 60000} minutes` };
        }
      } catch (recoveryErr: unknown) {
        rebaseResult = {
          success: false,
          reason: errorMessage(recoveryErr) || `Work agent ${agentId} could not be prepared for merge`,
        };
      }
    }

    if (!rebaseResult.success) {
      const error = rebaseResult.reason || 'Rebase failed';
      setReviewStatus(issueId, { mergeStatus: 'failed', mergeNotes: error, readyForMerge: false });
      completePendingOperation(issueId, error);

      // Post PR comment about failure
      try {
        if (artifactUrl) {
          const body = rebaseResult.conflictFiles?.length
            ? `## Merge Failed — Rebase Conflicts\n\nConflicts in: ${rebaseResult.conflictFiles.join(', ')}\n\nThe work agent has been notified to resolve conflicts.`
            : `## Merge Failed\n\n${error}`;
          await getForgeAdapter(primaryForge).commentOnArtifact({
            forge: primaryForge,
            url: artifactUrl,
            id: artifactId,
            cwd: workspacePath,
            body,
          });
        }
      } catch { /* non-fatal */ }

      return { success: false, statusCode: 500, error };
    }

    setReviewStatus(issueId, { mergeStep: 'stripping-planning' });
    // Strip .planning/ artifacts before merge — these are workspace-local
    // scratch files (STATE.md, feedback/) that must never land on main (#888).
    try {
      const { stdout: hasPlanning } = await execAsync(
        'git ls-files -- .planning/ 2>/dev/null || true',
        { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
      );
      if (hasPlanning.trim()) {
        console.log(`[merge] Stripping .planning/ artifacts from ${branchName} before merge...`);
        await execAsync('git rm -r --cached .planning/', { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 });
        await execAsync(
          `git commit -m "chore: strip .planning/ before merge"`,
          { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 }
        );
        await execAsync(
          `git push --force-with-lease origin HEAD:${branchName}`,
          { cwd: workspacePath, encoding: 'utf-8', timeout: 30000 }
        );
        console.log(`[merge] Stripped .planning/ from ${branchName}`);
      }
    } catch (stripErr: unknown) {
      console.warn(`[merge] Failed to strip .planning/ from ${branchName}: ${errorMessage(stripErr)}`);
      // Non-fatal: proceed to verification. The no-planning-on-main guardrail
      // will catch any .planning/ files that slip through.
    }

    // Step 3: Post-rebase verification gate (typecheck, lint, test)
    // Ensures the rebase didn't introduce issues before merging.
    setReviewStatus(issueId, { mergeStatus: 'verifying', mergeStep: 'verifying', mergeNotes: undefined });
    console.log(`[merge] Running post-rebase verification for ${issueId}...`);

    const { runVerificationForIssue } = await import(
      '../../../lib/cloister/verification-runner.js'
    );
    const verifyResult = await Effect.runPromise(runVerificationForIssue(
      issueId,
      workspacePath,
      { isRemote: false },
      'merge-verify',
      { syncTargetBranch: false },
    ));

    if (verifyResult.outcome === 'failed') {
      const error = `Post-rebase verification failed at ${verifyResult.failedCheck}`;
      console.log(`[merge] ${error}`);
      setReviewStatus(issueId, { mergeStatus: 'failed', mergeNotes: error, readyForMerge: false });
      completePendingOperation(issueId, error);

      // Post comment on PR so failure is visible
      try {
        if (artifactUrl) {
          await getForgeAdapter(primaryForge).commentOnArtifact({
            forge: primaryForge,
            url: artifactUrl,
            id: artifactId,
            cwd: workspacePath,
            body: `## Merge Blocked — Post-Rebase Verification Failed\n\nFailed check: ${verifyResult.failedCheck}\n\nThe branch was rebased successfully but verification failed. The work agent needs to fix the errors and resubmit.`,
          });
        }
      } catch { /* non-fatal */ }

      return { success: false, statusCode: 500, error };
    }
    console.log(`[merge] Post-rebase verification ${verifyResult.outcome} for ${issueId}`);

    // Step 4a: Report commit statuses on post-rebase HEAD (branch protection requires them).
    // Must happen AFTER rebase because rebase changes the HEAD SHA.
    setReviewStatus(issueId, { mergeStep: 'reporting-statuses' });
    try {
      const { getPullRequestState, isGitHubAppConfigured, reportCommitStatus } = await import('../../../lib/github-app.js');
      if (githubPrRef && isGitHubAppConfigured()) {
        const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
        const sha = prState.headSha.trim();
        if (sha) {
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'overdeck/review', 'Review passed');
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'overdeck/test', 'Tests passed');
          console.log(`[merge] Reported commit statuses on post-rebase HEAD for ${issueId} (${sha.slice(0, 8)})`);
        }
      }
    } catch (statusErr: unknown) {
      console.warn(`[merge] Failed to report commit statuses: ${errorMessage(statusErr)}`);
    }

    // Step 4b: Merge the review artifact via the configured forge.
    setReviewStatus(issueId, { mergeStep: 'squash-merging' });
    let artifactMerged = false;
    try {
      console.log(`[merge] Merging ${primaryForge} review artifact for ${issueId}...`);
      await getForgeAdapter(primaryForge).mergeReviewArtifact({
        forge: primaryForge,
        url: artifactUrl,
        id: artifactId,
        cwd: workspacePath,
        method: 'squash',
      });
      artifactMerged = true;
    } catch (prMergeErr: unknown) {
      console.error(`[merge] Review artifact merge threw for ${issueId}:`, prMergeErr);
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../lib/github-app.js');
        if (githubPrRef && isGitHubAppConfigured()) {
          const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
          artifactMerged = prState.merged;
          if (artifactMerged) {
            console.log(`[merge] Race-detected: PR #${githubPrRef.number} for ${issueId} was already merged despite thrown error; proceeding`);
          }
        }
      } catch (stateCheckErr: unknown) {
        console.warn(`[merge] Post-error PR state check failed for ${issueId}: ${errorMessage(stateCheckErr)}`);
      }

      if (!artifactMerged) {
        const error = `${primaryForge} merge failed: ${errorMessage(prMergeErr)}`;
        console.error(`[merge] ${error}`);
        const isTransient =
          errorMessage(prMergeErr)?.includes('Timed out waiting for GitHub PR') ||
          errorMessage(prMergeErr)?.includes('ECONNRESET') ||
          errorMessage(prMergeErr)?.includes('ETIMEDOUT') ||
          errorMessage(prMergeErr)?.includes('ECONNREFUSED');
        if (isTransient) {
          const reconciled = await reconcileGitHubMergeStatus(issueId, getReviewStatusSync(issueId));
          if (reconciled) {
            artifactMerged = true;
            console.log(`[merge] Reconciliation confirmed PR merged for ${issueId} after transient error; proceeding to success path`);
          } else {
            setReviewStatus(issueId, { mergeStatus: 'verifying', mergeNotes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 500, error };
          }
          // readyForMerge stays true while reconciliation catches up or the operator retries.
        } else {
          setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: error });
          completePendingOperation(issueId, error);
          return { success: false, statusCode: 500, error };
        }
      }
    }

    // Step 5: Mark merged and dequeue next BEFORE post-merge lifecycle.
    // postMergeLifecycle spawns a deploy script that may kill this server process,
    // so queue processing must happen before that point.
    setReviewStatus(issueId, { mergeStatus: 'merged', mergeStep: 'post-merge-cleanup', mergeNotes: undefined, readyForMerge: false });
    completePendingOperation(issueId, null);

    // Dequeue next merge before lifecycle (which may kill the process)
    advanceQueue();

    // Post-merge lifecycle runs last — may spawn deploy script that kills this server
    await postMergeLifecycle(issueId, projectPath, branchName);

    return {
      success: true,
      statusCode: 200,
      message: `Successfully merged ${primaryForge} review artifact for ${issueId}`,
      mergeStatus: 'merged',
      prUrl: prResult.prUrl,
    };
  } catch (error: unknown) {
    const mergeErrorMessage = `Merge pipeline error: ${errorMessage(error)}`;
    console.error(`[merge] Error for ${issueId}:`, error);
    setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: mergeErrorMessage });
    completePendingOperation(issueId, errorMessage(error));
    return { success: false, statusCode: 500, error: errorMessage(error) };
  } finally {
    advanceQueue();
  }

}