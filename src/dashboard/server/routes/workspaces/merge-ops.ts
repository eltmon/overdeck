/**
 * Merge-ops route module — extracted from routes/workspaces.ts.
 *
 * Merge / approve / queue endpoints:
 *   POST /api/issues/:issueId/sync-main
 *   POST /api/issues/:issueId/merge
 *   POST /api/issues/:issueId/forge-approve
 *   POST /api/issues/:issueId/forge-merge
 *   POST /api/issues/:issueId/approve
 *   GET  /api/merge-queue
 *   POST /api/internal/pipeline/notify
 *
 * Shared singletons (pending operations, project path, workspace info, readJsonBody)
 * stay owned by ../workspaces.js and are imported here.
 */

import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { messageAgent, getAgentState, spawnAgent } from '../../../../lib/agents.js';
import { queryBeadsForIssue, type BeadEntry } from '../../../../lib/beads-query.js';
import { syncMainIntoWorkspace } from '../../../../lib/cloister/merge-agent.js';
import { MainDivergedError, gitPush } from '../../../../lib/git/operations.js';
import { listGitOperationsSync } from '../../../../lib/git-activity.js';
import { extractNumberSync, extractPrefixSync, parseIssueIdSync } from '../../../../lib/issue-id.js';
import { enqueueMerge, getCurrentMerge, markMergeProcessing, dequeueMerge, getAllActiveQueues } from '../../../../lib/overdeck/merge.js';
import { findProjectByTeamSync } from '../../../../lib/projects.js';
import { getReviewStatusSync, markWorkspaceStuck, setReviewStatusSync as setReviewStatusBase, type ReviewStatus } from '../../../../lib/review-status.js';
import { getWorkAgentLifecycleStateSync } from '../../../../lib/work-agent-lifecycle.js';
import { findPlan } from '../../../../lib/vbrief/io.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared } from '../../../../lib/tracker-utils.js';
import { sessionExists } from '../../../../lib/tmux.js';
import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { setMergeQueueTriggerHandler } from '../../services/merge-queue-service.js';
import { httpHandler } from '../http-handler.js';
import { _serverManagedMerges } from '../specialists.js';
import { completePendingOperation, getPendingOperation, getProjectPath, getWorkspaceInfoForIssue, readJsonBody, setPendingOperation, setReviewStatus } from '../workspaces.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
    } catch (err: any) {
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

/**
 * Check whether origin/branchName already contains origin/targetBranch.
 * If true, no rebase is needed — the branch is already up to date with target.
 */
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


function parseGitHubPullRequestUrl(url?: string | null): { owner: string; repo: string; number: number } | null {
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

// Exported for unit tests covering late-success merge reconciliation guards.
export async function reconcileGitHubMergeStatus(issueId: string, status: Pick<ReviewStatus, 'prUrl' | 'mergeStatus' | 'readyForMerge'> | null | undefined): Promise<boolean> {
  if (!status?.prUrl) return false;

  const prRef = parseGitHubPullRequestUrl(status.prUrl);
  if (!prRef) return false;

  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../../../../lib/github-app.js');
    if (!isGitHubAppConfigured()) return false;

    const prState = await Effect.runPromise(getPullRequestState(prRef.owner, prRef.repo, prRef.number));
    console.log(`[merge] reconcileGitHubMergeStatus: ${issueId} PR #${prRef.number} merged=${prState.merged} state=${prState.state}`);
    if (!prState.merged) return false;

    setReviewStatus(issueId, {
      mergeStatus: 'merged',
      mergeNotes: undefined,
      readyForMerge: false,
    });
    completePendingOperation(issueId, null);
    return true;
  } catch (err: any) {
    console.warn(`[merge] Failed to reconcile PR state for ${issueId}: ${err.message}`);
    return false;
  }
}


async function readBeadsFromJsonl(workspacePath: string, issueId: string): Promise<BeadEntry[]> {
  try {
    const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
    if (!existsSync(jsonlPath)) return [];
    const raw = await readFile(jsonlPath, 'utf-8');
    const issueLower = issueId.toLowerCase();
    const beads: BeadEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const labels = Array.isArray(entry.labels) ? entry.labels : [];
        if (labels.some((l: string) => l.toLowerCase() === issueLower)) {
          beads.push({
            id: String(entry.id ?? ''),
            title: String(entry.title ?? ''),
            status: String(entry.status ?? 'open'),
            labels: labels as string[],
          });
        }
      } catch { /* skip malformed lines */ }
    }
    return beads;
  } catch {
    return [];
  }
}

/**
 * Build a rich PR body with issue link, beads task summary, and AC checklist
 * from the vBRIEF plan. Exported for testing.
 */
export async function buildRichPRBody(issueId: string, workspacePath: string): Promise<string> {
  const lines: string[] = [];

  // Non-closing reference on purpose: a closing keyword ("Closes #N") hands
  // close authority to GitHub, which fires the moment the PR's head becomes
  // reachable from main and races the pipeline's verifying_on_main → close-out
  // lifecycle (the first UAT batch promote closed 2 of 3 member issues
  // mid-handoff, 2026-06-11). Overdeck's close-out owns issue closing.
  lines.push(`**Issue:** #${extractNumberSync(issueId) ?? issueId}`);
  lines.push('');

  // Acceptance criteria checklist from vBRIEF plan items
  try {
    const planPath = await Effect.runPromise(findPlan(workspacePath));
    if (planPath && existsSync(planPath)) {
      const raw = await readFile(planPath, 'utf-8');
      const doc = JSON.parse(raw);
      const items: Array<{ status: string; title: string }> = doc?.plan?.items ?? [];
      if (items.length > 0) {
        lines.push('## Acceptance Criteria');
        lines.push('');
        for (const item of items) {
          const checked = item.status === 'completed' ? 'x' : ' ';
          lines.push(`- [${checked}] ${item.title}`);
        }
        lines.push('');
      }
    }
  } catch {
    // No vBRIEF plan — omit checklist
  }

  // Beads task summary from live Dolt database via bd CLI
  try {
    // Use a short lock timeout so PR-body generation does not block behind CLI
    // processes that hold the cross-process bd lock. queryBeadsForIssue already
    // falls back to JSONL on failure, so the explicit fallback here is a safety net.
    const queryResult = await Effect.runPromise(
      queryBeadsForIssue(workspacePath, issueId, { acquisitionTimeoutMs: 500 }),
    );
    let beads = queryResult.beads;
    if (beads.length === 0) {
      // Fallback: read from .beads/issues.jsonl when bd CLI is unavailable
      beads = await readBeadsFromJsonl(workspacePath, issueId);
    }
    if (beads.length > 0) {
      lines.push('## Implementation Tasks');
      lines.push('');
      for (const bead of beads) {
        const checked = bead.status === 'closed' ? 'x' : ' ';
        lines.push(`- [${checked}] ${bead.title.replace(/^[^:]+:\s*/, '')}`);
      }
      lines.push('');
    }
  } catch {
    // No beads — omit task list
  }

  return lines.join('\n') || `Automated PR for ${issueId}`;
}

async function ensurePRExists(
  issueId: string,
  options?: { cwd?: string; branchName?: string; targetBranch?: string }
): Promise<{ created: boolean; prUrl?: string; error?: string }> {
  try {
    const issueLower = issueId.toLowerCase();
    const branchName = options?.branchName ?? `feature/${issueLower}`;
    const targetBranch = options?.targetBranch ?? 'main';
    const execOptions: Parameters<typeof execFileAsync>[2] = { encoding: 'utf-8' };
    if (options?.cwd) execOptions.cwd = options.cwd;

    // Check for existing PR
    let existingOut: string = '';
    try {
      const { stdout } = await execFileAsync('gh', ['pr', 'view', branchName, '--json', 'url', '--jq', '.url'], execOptions);
      existingOut = String(stdout);
    } catch { /* no existing PR */ }
    const existing = existingOut.trim();
    if (existing) return { created: false, prUrl: existing };

    // Build rich PR body if workspace path is available
    const prBody = options?.cwd ? await buildRichPRBody(issueId, options.cwd) : `Automated PR for ${issueId}`;

    // Write body to a temp file to avoid shell escaping issues
    const { tmpdir } = await import('os');
    const { join: pathJoin } = await import('path');
    const { writeFile: writeFileAsync, unlink: unlinkAsync } = await import('fs/promises');
    const bodyFile = pathJoin(tmpdir(), `pan-pr-body-${issueId}-${Date.now()}.md`);
    await writeFileAsync(bodyFile, prBody, 'utf-8');

    try {
      const { stdout: rawOut } = await execFileAsync('gh', ['pr', 'create', '--head', branchName, '--base', targetBranch, '--title', issueId, '--body-file', bodyFile], execOptions);
      const createOut = String(rawOut);
      // gh pr create prints the PR URL as the last line of stdout
      const prUrl = createOut.trim().split('\n').pop()?.trim() || createOut.trim();
      return { created: true, prUrl };
    } finally {
      unlinkAsync(bodyFile).catch(() => {});
    }
  } catch (err: any) {
    return { created: false, error: err.message };
  }
}


export async function pushApproveMain(
  issueId: string,
  projectPath: string,
): Promise<ApprovePushResult> {
  try {
    await Effect.runPromise(gitPush(projectPath, 'origin', 'main', { issueId }));
    return { pushed: true };
  } catch (pushErr: unknown) {
    if (pushErr instanceof MainDivergedError) {
      // Mark the workspace stuck so Deacon skips it — no automatic retry.
      // Do NOT hard-reset local main here: that is a destructive operation that
      // must be explicit/user-confirmed, not a silent side-effect of a failed push.
      // The stuck flag prevents any further automatic approve attempts; when the
      // user manually unsticks and retries, the approve route's git pull --ff-only
      // step will detect the orphaned merge commit and surface a recoverable error
      // with instructions to run: git reset --hard origin/main
      markWorkspaceStuck(issueId, 'main_diverged', {
        localSha: pushErr.localSha,
        remoteSha: pushErr.remoteSha,
      });
      const error = `Push aborted: origin/main has advanced past your local ancestor (remote: ${pushErr.remoteSha?.slice(0, 7)}, local: ${pushErr.localSha?.slice(0, 7)}). A hotfix may have landed. Workspace marked stuck — to recover: cd ${projectPath} && git reset --hard origin/main, then unstick and retry.`;
      return { pushed: false, httpStatus: 409, error };
    }
    const message = pushErr instanceof Error ? pushErr.message : String(pushErr);
    const error = `Merge succeeded but push failed! Your work is safe locally.\nPlease push manually: cd ${projectPath} && git push origin main\nError: ${message}`;
    return { pushed: false, httpStatus: 400, error };
  }
}


// ─── Route: POST /api/issues/:issueId/sync-main ──────────────────────────

const postWorkspaceSyncMainRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/sync-main',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    if (workspaceInfo.isRemote) {
      return jsonResponse(
        {
          success: false,
          error: 'Sync with Main is not supported for remote workspaces',
        },
        { status: 400 }
      );
    }

    const workspacePath =
      workspaceInfo.localPath ||
      join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!existsSync(workspacePath)) {
      return jsonResponse(
        { success: false, error: 'Workspace does not exist' },
        { status: 400 }
      );
    }

    console.log(`[sync-main] Starting sync for ${issueId} at ${workspacePath}`);

    const result = yield* Effect.promise(() => syncMainIntoWorkspace(workspacePath, issueId));

    if (result.success) {
      if (result.alreadyUpToDate) {
        return jsonResponse({
          success: true,
          alreadyUpToDate: true,
          message: 'Already up to date with main',
        });
      }
      return jsonResponse({
        success: true,
        commitCount: result.commitCount || 0,
        changedFiles: result.changedFiles || [],
        message: `Synced ${result.commitCount || 0} commit(s) from main`,
      });
    } else {
      const status = result.reason?.includes('uncommitted') ? 400 : 500;
      return jsonResponse(
        {
          success: false,
          error: result.reason || 'Sync failed',
          conflictFiles: result.conflictFiles,
        },
        { status }
      );
    }
  }))
);

// ─── Shared triggerMerge logic ────────────────────────────────────────────────

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

// Per-project merge queue backed by SQLite (PAN-632).
// Replaces the in-memory _mergeQueues Map — survives server restarts.

/** Dequeue the next merge after current completes (success or failure). */
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
      const { isGitHubAppConfigured, reportCommitStatus } = await import('../../../../lib/github-app.js');
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
    } catch (err: any) {
      console.warn(`[merge] Failed to report commit statuses: ${err.message}`);
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
      const { getMergeSetSync, ensureMergeSetForIssueSync } = await import('../../../../lib/merge-set.js');
      const { getForgeAdapter } = await import('../../../../lib/forge.js');
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

        const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
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
      } catch (remoteErr: any) {
        const mergeErrorMessage = `Remote merge failed: ${remoteErr.message}`;
        console.error(`[merge] Remote merge failed for ${issueId}:`, remoteErr);
        setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: mergeErrorMessage });
        completePendingOperation(issueId, remoteErr.message);
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
      const { getMergeSetSync, ensureMergeSetForIssueSync, upsertMergeSetSync, withRepoStateSync } = await import('../../../../lib/merge-set.js');
      const { runQualityGates } = await import('../../../../lib/cloister/validation.js');
      const { getForgeAdapter } = await import('../../../../lib/forge.js');
      const { messageAgent } = await import('../../../../lib/agents.js');
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
        } catch (mergeErr: any) {
          const error = mergeErr.message || 'Artifact merge failed';
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

      const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
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
    const { getMergeSetSync, ensureMergeSetForIssueSync } = await import('../../../../lib/merge-set.js');
    const { getForgeAdapter } = await import('../../../../lib/forge.js');
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
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../../lib/github-app.js');
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
            const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
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
      } catch (prStateErr: any) {
        console.warn(`[merge] Pre-merge PR state check failed for ${issueId}: ${prStateErr.message} — proceeding (check is best-effort)`);
      }
    }

    // Step 2: Tell the WORK AGENT to rebase onto the target branch and push.
    // The server coordinates; the work agent owns all code-changing git operations.
    const { postMergeLifecycle } = await import(
      '../../../../lib/cloister/merge-agent.js'
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
      } catch (recoveryErr: any) {
        rebaseResult = {
          success: false,
          reason: recoveryErr.message || `Work agent ${agentId} could not be prepared for merge`,
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
    } catch (stripErr: any) {
      console.warn(`[merge] Failed to strip .planning/ from ${branchName}: ${stripErr.message}`);
      // Non-fatal: proceed to verification. The no-planning-on-main guardrail
      // will catch any .planning/ files that slip through.
    }

    // Step 3: Post-rebase verification gate (typecheck, lint, test)
    // Ensures the rebase didn't introduce issues before merging.
    setReviewStatus(issueId, { mergeStatus: 'verifying', mergeStep: 'verifying', mergeNotes: undefined });
    console.log(`[merge] Running post-rebase verification for ${issueId}...`);

    const { runVerificationForIssue } = await import(
      '../../../../lib/cloister/verification-runner.js'
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
      const { getPullRequestState, isGitHubAppConfigured, reportCommitStatus } = await import('../../../../lib/github-app.js');
      if (githubPrRef && isGitHubAppConfigured()) {
        const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
        const sha = prState.headSha.trim();
        if (sha) {
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'overdeck/review', 'Review passed');
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'overdeck/test', 'Tests passed');
          console.log(`[merge] Reported commit statuses on post-rebase HEAD for ${issueId} (${sha.slice(0, 8)})`);
        }
      }
    } catch (statusErr: any) {
      console.warn(`[merge] Failed to report commit statuses: ${statusErr.message}`);
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
    } catch (prMergeErr: any) {
      console.error(`[merge] Review artifact merge threw for ${issueId}:`, prMergeErr);
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../../lib/github-app.js');
        if (githubPrRef && isGitHubAppConfigured()) {
          const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
          artifactMerged = prState.merged;
          if (artifactMerged) {
            console.log(`[merge] Race-detected: PR #${githubPrRef.number} for ${issueId} was already merged despite thrown error; proceeding`);
          }
        }
      } catch (stateCheckErr: any) {
        console.warn(`[merge] Post-error PR state check failed for ${issueId}: ${stateCheckErr.message}`);
      }

      if (!artifactMerged) {
        const error = `${primaryForge} merge failed: ${prMergeErr.message}`;
        console.error(`[merge] ${error}`);
        const isTransient =
          prMergeErr.message?.includes('Timed out waiting for GitHub PR') ||
          prMergeErr.message?.includes('ECONNRESET') ||
          prMergeErr.message?.includes('ETIMEDOUT') ||
          prMergeErr.message?.includes('ECONNREFUSED');
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
  } catch (error: any) {
    const mergeErrorMessage = `Merge pipeline error: ${error.message}`;
    console.error(`[merge] Error for ${issueId}:`, error);
    setReviewStatus(issueId, { mergeStatus: 'failed', readyForMerge: false, mergeNotes: mergeErrorMessage });
    completePendingOperation(issueId, error.message);
    return { success: false, statusCode: 500, error: error.message };
  } finally {
    advanceQueue();
  }

}

setMergeQueueTriggerHandler(triggerMerge);

// ─── Route: POST /api/issues/:issueId/merge ───────────────────────────────

const postWorkspaceMergeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/merge',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!/^[A-Z]+-\d+$/i.test(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID format' }, { status: 400 });
    }
    const eventStore = yield* EventStoreService;

    const result = yield* Effect.promise(() => triggerMerge(issueId));
    if (result.success) {
      yield* Effect.promise(() => Effect.runPromise(eventStore.append({
        type: 'merge.ready',
        timestamp: new Date().toISOString(),
        payload: { issueId },
      })));
    }
    const { statusCode, ...body } = result;
    return jsonResponse(body, { status: statusCode });
  }))
);

// ─── Route: POST /api/issues/:issueId/forge-approve ──────────────────────
// Approves the PR/MR on GitHub/GitLab (submits an approving review).
// This is distinct from the Overdeck /approve endpoint which runs the
// full merge flow. This just clicks "Approve" on the forge.

const postForgeApproveRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/forge-approve',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!/^[A-Z]+-\d+$/i.test(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID format' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
      const { getMergeSetSync, upsertMergeSetSync, withRepoArtifactUrlSync, withRepoStateSync } = await import('../../../../lib/merge-set.js');
      const { getForgeAdapter } = await import('../../../../lib/forge.js');

      let mergeSet = getMergeSetSync(issueId);
      if (!mergeSet) {
        return jsonResponse({ error: `No merge set found for ${issueId}` }, { status: 404 });
      }

      const results: Array<{ repoKey: string; approved: boolean; error?: string }> = [];
      for (const repo of mergeSet.repos) {
        if (repo.mergeStatus === 'merged' || repo.mergeStatus === 'skipped') {
          results.push({ repoKey: repo.repoKey, approved: true });
          continue;
        }

        const adapter = getForgeAdapter(repo.forge);
        const workspacePath = mergeSet.workspaceType === 'polyrepo'
          ? join(mergeSet.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, repo.repoKey)
          : join(mergeSet.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);

        let artifactUrl = repo.artifactUrl;
        let artifactId = repo.artifactId;

        if (!artifactUrl && !artifactId) {
          try {
            const discovered = await adapter.discoverArtifact({
              sourceBranch: repo.sourceBranch,
              cwd: existsSync(workspacePath) ? workspacePath : repo.repoPath,
            });
            if (discovered?.url || discovered?.id) {
              artifactUrl = discovered.url;
              artifactId = discovered.id;
              mergeSet = withRepoArtifactUrlSync(mergeSet, repo.repoKey, artifactUrl ?? '', artifactId);
              upsertMergeSetSync(mergeSet);
              console.log(`[forge-approve] Discovered artifact for ${issueId}/${repo.repoKey}: ${artifactUrl}`);
            } else {
              results.push({ repoKey: repo.repoKey, approved: true });
              continue;
            }
          } catch {
            results.push({ repoKey: repo.repoKey, approved: true });
            continue;
          }
        }

        try {
          await adapter.approveReviewArtifact({
            forge: repo.forge,
            url: artifactUrl,
            id: artifactId,
            cwd: existsSync(workspacePath) ? workspacePath : repo.repoPath,
          });
          results.push({ repoKey: repo.repoKey, approved: true });
        } catch (err: any) {
          results.push({ repoKey: repo.repoKey, approved: false, error: err.message });
        }
      }

      const approvedCount = results.filter(r => r.approved).length;
      if (approvedCount > 0) {
        const { emitActivityEntrySync, emitActivityTtsSync } = await import('../../../../lib/activity-logger.js');
        emitActivityEntrySync({
          source: 'dashboard',
          level: 'success',
          message: `Merge approved for ${issueId}`,
          issueId,
        });
        emitActivityTtsSync({
          utterance: `Merge approved for ${issueId}`,
          priority: 1,
          issueId,
          source: 'dashboard',
          eventType: 'merge.approved',
        });
      }

      const allApproved = results.every(r => r.approved);
      return jsonResponse(
        { success: allApproved, results },
        { status: allApproved ? 200 : 207 }
      );
    });
  }))
);

// ─── Route: POST /api/issues/:issueId/forge-merge ────────────────────────
// Merges the PR/MR directly on GitHub/GitLab via the forge adapter.
// This is a lightweight forge-level merge — it does NOT run Overdeck's
// full post-merge lifecycle (label cleanup, workspace teardown, etc.).

const postForgeMergeRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/forge-merge',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!/^[A-Z]+-\d+$/i.test(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID format' }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
      const { getMergeSetSync, upsertMergeSetSync, withRepoArtifactUrlSync, withRepoStateSync } = await import('../../../../lib/merge-set.js');
      const { getForgeAdapter } = await import('../../../../lib/forge.js');

      let mergeSet = getMergeSetSync(issueId);
      if (!mergeSet) {
        return jsonResponse({ error: `No merge set found for ${issueId}` }, { status: 404 });
      }

      const results: Array<{ repoKey: string; merged: boolean; error?: string }> = [];
      for (const repo of mergeSet.repos) {
        if (repo.mergeStatus === 'merged' || repo.mergeStatus === 'skipped') {
          results.push({ repoKey: repo.repoKey, merged: true });
          continue;
        }

        const adapter = getForgeAdapter(repo.forge);
        const workspacePath = mergeSet.workspaceType === 'polyrepo'
          ? join(mergeSet.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`, repo.repoKey)
          : join(mergeSet.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);

        let artifactUrl = repo.artifactUrl;
        let artifactId = repo.artifactId;

        if (!artifactUrl && !artifactId) {
          try {
            const discovered = await adapter.discoverArtifact({
              sourceBranch: repo.sourceBranch,
              cwd: existsSync(workspacePath) ? workspacePath : repo.repoPath,
            });
            if (discovered?.url || discovered?.id) {
              artifactUrl = discovered.url;
              artifactId = discovered.id;
              mergeSet = withRepoArtifactUrlSync(mergeSet, repo.repoKey, artifactUrl ?? '', artifactId);
              upsertMergeSetSync(mergeSet);
              console.log(`[forge-merge] Discovered artifact for ${issueId}/${repo.repoKey}: ${artifactUrl}`);
            } else {
              mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'skipped' });
              upsertMergeSetSync(mergeSet);
              results.push({ repoKey: repo.repoKey, merged: true });
              continue;
            }
          } catch {
            mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'skipped' });
            upsertMergeSetSync(mergeSet);
            results.push({ repoKey: repo.repoKey, merged: true });
            continue;
          }
        }

        try {
          await adapter.mergeReviewArtifact({
            forge: repo.forge,
            url: artifactUrl,
            id: artifactId,
            method: 'squash',
            cwd: existsSync(workspacePath) ? workspacePath : repo.repoPath,
          });
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'merged' });
          upsertMergeSetSync(mergeSet);
          results.push({ repoKey: repo.repoKey, merged: true });
        } catch (err: any) {
          results.push({ repoKey: repo.repoKey, merged: false, error: err.message });
        }
      }

      const mergedCount = results.filter(r => r.merged).length;
      if (mergedCount > 0) {
        const { emitActivityEntrySync, emitActivityTtsSync } = await import('../../../../lib/activity-logger.js');
        emitActivityEntrySync({
          source: 'dashboard',
          level: 'success',
          message: `Merged ${issueId} on ${mergeSet.repos[0]?.forge ?? 'forge'}`,
          issueId,
        });
        emitActivityTtsSync({
          utterance: `${issueId} has been merged`,
          priority: 1,
          issueId,
          source: 'dashboard',
          eventType: 'forgeMerge.merged',
        });
      }

      const allMerged = results.every(r => r.merged);
      return jsonResponse(
        { success: allMerged, results },
        { status: allMerged ? 200 : 207 }
      );
    });
  }))
);

// ─── Route: POST /api/issues/:issueId/approve ────────────────────────────

const postWorkspaceApproveRoute = HttpRouter.add(
  'POST',
  '/api/issues/:issueId/approve',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const existingStatus = getReviewStatusSync(issueId);
    if (
      existingStatus?.readyForMerge &&
      existingStatus.reviewStatus === 'passed' &&
      existingStatus.testStatus === 'passed'
    ) {
      console.log(
        `[approve] Review+test already passed for ${issueId}, forwarding to merge endpoint...`
      );
      const apiPort = process.env.API_PORT || process.env.PORT || '3011';
      try {
        const mergeRes = yield* Effect.promise(() => fetch(
          `http://localhost:${apiPort}/api/issues/${issueId}/merge`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        ));
        const mergeData = (yield* Effect.promise(() => mergeRes.json())) as any;
        return jsonResponse(mergeData, { status: mergeRes.status });
      } catch (err: any) {
        return jsonResponse(
          { error: `Failed to forward to merge: ${err.message}` },
          { status: 500 }
        );
      }
    }

    return yield* Effect.promise(async () => {
        const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
        const projectPath = getProjectPath(undefined, issuePrefix);
        const issueLower = issueId.toLowerCase();
        const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
        const branchName = `feature/${issueLower}`;

        setPendingOperation(issueId, 'approve');

        if (!existsSync(workspacePath)) {
          completePendingOperation(issueId, 'Workspace does not exist');
          return jsonResponse({ error: 'Workspace does not exist' }, { status: 400 });
        }

        try {
          await execAsync(`git rev-parse --verify ${branchName}`, {
            cwd: projectPath,
            encoding: 'utf-8',
          });
        } catch {
          completePendingOperation(issueId, `Branch ${branchName} does not exist`);
          return jsonResponse(
            { error: `Branch ${branchName} does not exist` },
            { status: 400 }
          );
        }

        try {
          const { stdout: status } = await execAsync(
            'git status --porcelain -uno',
            { cwd: workspacePath, encoding: 'utf-8' }
          );
          if (status.trim()) {
            const error = `Workspace has uncommitted changes. Please commit the changes, explicitly discard them, or surface them to the operator first:\ncd ${workspacePath}\ngit status`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 400 });
          }
        } catch {}

        try {
          await execAsync(`git push origin ${branchName}`, {
            cwd: workspacePath,
            encoding: 'utf-8',
          });
        } catch (pushErr: any) {
          console.log(`Feature branch push note: ${pushErr.message}`);
        }

        // Concurrent-merge detection: warn if another push to main succeeded in the last 30s.
        // recentPushWarning is included in the success response body below (line ~4146) so
        // the caller can surface it to the operator without a separate lookup.
        const recentCutoff = new Date(Date.now() - 30_000).toISOString();
        const recentMainPushes = listGitOperationsSync({ operation: 'push', since: recentCutoff })
          .filter((op) => op.status === 'success' && op.branch === 'main' && op.issueId !== issueId);
        const recentPushWarning = recentMainPushes.length > 0
          ? `Another workspace pushed to main ${Math.round((Date.now() - new Date(recentMainPushes[0].ts).getTime()) / 1000)}s ago — divergence possible`
          : undefined;
        if (recentPushWarning) {
          console.warn(`[approve] ${recentPushWarning} (${issueId})`);
        }

        try {
          await execAsync('git checkout main', { cwd: projectPath, encoding: 'utf-8' });
          await execAsync('git fetch origin main', { cwd: projectPath, encoding: 'utf-8' });
          // Detect orphaned merge commit: local main is AHEAD of origin/main from a
          // previous approve attempt whose push failed. git pull --ff-only would fail
          // here with "not possible to fast-forward". Surface a recoverable error
          // with explicit instructions rather than silently hard-resetting.
          const { stdout: aheadCountRaw } = await execAsync(
            'git rev-list origin/main..HEAD --count',
            { cwd: projectPath, encoding: 'utf-8' }
          );
          const aheadCount = parseInt(aheadCountRaw.trim(), 10) || 0;
          if (aheadCount > 0) {
            const error = `Local main is ${aheadCount} commit(s) ahead of origin/main — a previous approve attempt left an unpushed merge commit. To recover, run:\n  cd ${projectPath} && git reset --hard origin/main\nThen unstick the workspace and retry.`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 409 });
          }
          await execAsync('git pull origin main --ff-only', {
            cwd: projectPath,
            encoding: 'utf-8',
          });
        } catch (checkoutErr: any) {
          const error = `Failed to checkout/update main branch: ${checkoutErr.message}`;
          completePendingOperation(issueId, error);
          return jsonResponse({ error }, { status: 400 });
        }

        // Divergence preview: count how many commits main has advanced past the feature branch
        let mainAdvancedBy = 0;
        try {
          const { stdout: aheadRaw } = await execAsync(
            `git rev-list ${branchName}..main --count`,
            { cwd: projectPath, encoding: 'utf-8' }
          );
          mainAdvancedBy = parseInt(aheadRaw.trim(), 10) || 0;
          if (mainAdvancedBy > 0) {
            console.log(`[approve] main has advanced ${mainAdvancedBy} commit(s) past ${branchName}`);
          }
        } catch {}

        console.log(`[approve] Starting role pipeline for ${issueId}...`);

        // PAN-1048 R3: route through the same wrapper every other approve path
        // uses (idempotency + feedback archive + status flip
        // + pipeline event). The role agent loads roles/review.md, fans out the
        // four code-review-* convoy reviewers via Agent tool, synthesizes, and
        // posts the verdict via /api/review/:id/status. Test dispatch is NOT
        // part of the review prompt — reactive Cloister picks up the
        // review.approved lifecycle event and spawns the test role.
        let reviewResult: { success: boolean; message: string; error?: string; gated?: boolean };
        try {
          const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
          reviewResult = await Effect.runPromise(spawnReviewRoleForIssue({
            issueId,
            workspace: workspacePath,
            branch: branchName,
            prUrl: getReviewStatusSync(issueId)?.prUrl,
          }));
        } catch (err: any) {
          reviewResult = {
            success: false,
            message: err?.message ?? 'Failed to start review role',
            error: err?.message,
          };
        }

        if (!reviewResult.success) {
          if (reviewResult.gated) {
            console.log(`[approve] review dispatch deferred for ${issueId}: ${reviewResult.message}`);
            completePendingOperation(issueId, reviewResult.message);
            setReviewStatusBase(issueId, {
              reviewStatus: 'pending',
              reviewNotes: reviewResult.message,
            });
            return jsonResponse({
              success: false,
              gated: true,
              message: reviewResult.message,
              pipeline: 'deferred',
              ...(recentPushWarning && { recentPushWarning }),
              ...(mainAdvancedBy > 0 && { mainAdvancedBy }),
            }, { status: 409 });
          }

          console.warn(`[approve] review role failed to start: ${reviewResult.message}`);
          console.log(`[approve] Falling back to direct merge...`);
        } else {
          console.log(
            `[approve] Pipeline started - review role will synthesize convoy findings`
          );
          completePendingOperation(issueId, null);
          return jsonResponse({
            success: true,
            message: `Approval pipeline started for ${issueId}. Role: review`,
            pipeline: 'running',
            note: 'Watch the role run for progress. Click Merge when review+test pass.',
            ...(recentPushWarning && { recentPushWarning }),
            ...(mainAdvancedBy > 0 && { mainAdvancedBy }),
          });
        }

        // Fallback (PAN-1531): direct server-side rebase via rebaseFeatureBranch.
        // The ship-role LLM agent was retired — rebase is deterministic mechanical
        // work and runs in-process. On success the workspace branch is pushed to
        // origin with --force-with-lease and the dashboard flips readyForMerge so
        // the human Merge button renders. On conflict the operator resolves
        // manually in the workspace and re-requests review.
        console.log(`[approve] Step 3/3: Running server-side rebase for ${issueId}...`);

        try {
          const { rebaseFeatureBranch } = await import(
            '../../../../lib/cloister/merge-rebase.js'
          );
          const workspacePathForRebase = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
          const rebaseResult = await Effect.runPromise(
            rebaseFeatureBranch(workspacePathForRebase, branchName, 'main', issueId),
          );

          if (!rebaseResult.success) {
            const conflictDetail = rebaseResult.conflictFiles?.length
              ? `\nConflict files: ${rebaseResult.conflictFiles.join(', ')}`
              : '';
            const error = `Rebase blocked for ${issueId}.\nReason: ${rebaseResult.reason ?? 'Unknown'}${conflictDetail}\n\nResume in workspace:\n  cd ${workspacePathForRebase}\n  git rebase origin/main\n  # resolve conflicts, then\n  git push --force-with-lease`;
            completePendingOperation(issueId, error);
            return jsonResponse({ error }, { status: 400 });
          }

          console.log(`[approve] Rebase complete for ${issueId} (${rebaseResult.skipped ? 'no-op' : 'rebased'}); ready for human Merge button`);
        } catch (rebaseError: any) {
          const error = `Server-side rebase failed: ${rebaseError.message}\n\nResolve manually:\n  cd <workspace>\n  git rebase origin/main\n  git push --force-with-lease`;
          completePendingOperation(issueId, error);
          return jsonResponse({ error }, { status: 400 });
        }

        // Push merged main (with divergence guard — pushApproveMain catches MainDivergedError
        // and marks workspace stuck if origin/main advanced past our local ancestor)
        const pushResult = await pushApproveMain(issueId, projectPath);
        if (!pushResult.pushed) {
          completePendingOperation(issueId, pushResult.error);
          return jsonResponse({ error: pushResult.error }, { status: pushResult.httpStatus });
        }

        // Post-merge lifecycle
        const { approve: lifecycleApprove } = await import('../../../../lib/lifecycle/index.js');
        const ghResolved = resolveGitHubIssueShared(issueId);
        const isGitHubIssueFlag = ghResolved.isGitHub;
        const lifecycleCtx = {
          issueId,
          projectPath,
          ...(ghResolved.isGitHub
            ? {
                github: {
                  owner: ghResolved.owner,
                  repo: ghResolved.repo,
                  number: ghResolved.number,
                },
              }
            : {}),
        };

        const lifecycleResult = await Effect.runPromise(lifecycleApprove(lifecycleCtx));
        console.log(
          `[approve] Lifecycle completed for ${issueId}: ${lifecycleResult.steps
            .filter((s: any) => s.success && !s.skipped)
            .map((s: any) => s.step)
            .join(', ')}`
        );

        if (isGitHubIssueFlag) {
          try {
            await execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 });
          } catch (syncError: any) {
            console.error('pan sync failed (non-fatal):', syncError.message);
          }
        }

        completePendingOperation(issueId);

        return jsonResponse({
          success: true,
          message: `Approved ${issueId}: ${lifecycleResult.steps
            .filter((s: any) => s.success && !s.skipped)
            .map((s: any) => s.step)
            .join(', ')}${isGitHubIssueFlag ? ', skills synced' : ''}`,
        });
    });
  }))
);


// ─── Route: GET /api/merge-queue ─────────────────────────────────────────────

const getMergeQueueRoute = HttpRouter.add(
  'GET',
  '/api/merge-queue',
  httpHandler(Effect.gen(function* () {
    const queues = getAllActiveQueues();
    return jsonResponse({ queues });
  })),
);

// ─── Route: POST /api/internal/pipeline/notify ────────────────────────────────
//
// Cross-process bridge for `notifyPipeline()` (PAN-891, expanded in PAN-915).
//
// `notifyPipeline` is an in-process handler registry; only the dashboard server
// registers a handler. CLI processes (e.g. `pan review run`) write to shared
// state and call `notifyPipeline()`, which is a no-op in their own process.
// This endpoint lets them poke the dashboard so it re-emits the corresponding
// domain event into the live event stream.
//
// Accepted bodies (PAN-915):
//   { type: 'status_changed', issueId }
//     — Server re-reads ReviewStatus from SQLite (avoids stale snapshots) and
//       dispatches via in-process handler.
//   { type: 'review.approved', issueId }
//   { type: 'test.passed', issueId }
//   { type: 'task_queued', specialist, issueId }
//   { type: 'reviewer_started', issueId, role, sessionName }
//   { type: 'reviewer_completed', issueId, role }
//   { type: 'reviewer_timed_out', issueId, role, sessionName, attempt, maxRetries, willRetry }
//   { type: 'coordinator_started', issueId, sessionName }
//   { type: 'coordinator_died', issueId, sessionName, reason }
//     — Forwarded verbatim to the in-process handler.

const postInternalPipelineNotifyRoute = HttpRouter.add(
  'POST',
  '/api/internal/pipeline/notify',
  httpHandler(Effect.gen(function* () {
    // Shared-secret check (PAN-891 review feedback). The dashboard binds 0.0.0.0
    // by default, so this stateful endpoint must be unreachable without the
    // server-issued token. Same token is read by CLI senders via getInternalToken().
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { INTERNAL_TOKEN_HEADER, getInternalTokenSync } = yield* Effect.promise(() =>
      import('../../../../lib/internal-token.js'),
    );
    const expected = getInternalTokenSync();
    if (!expected) {
      return jsonResponse({ ok: false, error: 'internal token not configured' }, 503);
    }
    const headers = request.headers as Record<string, string | string[] | undefined>;
    const raw = headers[INTERNAL_TOKEN_HEADER];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (!provided || provided !== expected) {
      return jsonResponse({ ok: false, error: 'forbidden' }, 403);
    }

    const body = yield* readJsonBody;
    const event = body as Record<string, unknown>;
    const type = event.type as string | undefined;

    const { notifyPipelineSync } = yield* Effect.promise(() =>
      import('../../../../lib/pipeline-notifier.js'),
    );

    switch (type) {
      case 'status_changed': {
        const issueId = event.issueId as string | undefined;
        if (!issueId) {
          return jsonResponse({ ok: false, error: 'status_changed requires issueId' }, 400);
        }
        const status = getReviewStatusSync(issueId);
        if (!status) {
          return jsonResponse({ ok: false, error: `no review status found for ${issueId}` }, 404);
        }
        notifyPipelineSync({ type: 'status_changed', issueId, status });
        return jsonResponse({ ok: true });
      }
      case 'review.approved':
      case 'test.passed': {
        const issueId = event.issueId as string | undefined;
        if (!issueId) {
          return jsonResponse({ ok: false, error: `${type} requires issueId` }, 400);
        }
        // PAN-1988: this MUST be notifyPipelineSync (the imported function). The bare
        // `notifyPipeline` (the Effect variant) is not imported here, so it threw
        // "notifyPipeline is not defined" and silently dropped EVERY forwarded review.approved /
        // test.passed event — breaking the reactive review→test and test→ship handoffs for any
        // CLI-originated verdict. The in-process dashboard handler routes these to reactive Cloister.
        notifyPipelineSync({ type, issueId });
        return jsonResponse({ ok: true });
      }
      case 'task_queued': {
        const issueId = event.issueId as string | undefined;
        const specialist = event.specialist as string | undefined;
        if (!issueId || !specialist) {
          return jsonResponse({ ok: false, error: 'task_queued requires issueId and specialist' }, 400);
        }
        notifyPipelineSync({ type: 'task_queued', specialist, issueId });
        return jsonResponse({ ok: true });
      }
      case 'reviewer_started': {
        const issueId = event.issueId as string | undefined;
        const role = event.role as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        if (!issueId || !role || !sessionName) {
          return jsonResponse({ ok: false, error: 'reviewer_started requires issueId, role, sessionName' }, 400);
        }
        notifyPipelineSync({ type: 'reviewer_started', issueId, role, sessionName });
        return jsonResponse({ ok: true });
      }
      case 'reviewer_completed': {
        const issueId = event.issueId as string | undefined;
        const role = event.role as string | undefined;
        if (!issueId || !role) {
          return jsonResponse({ ok: false, error: 'reviewer_completed requires issueId, role' }, 400);
        }
        notifyPipelineSync({ type: 'reviewer_completed', issueId, role });
        return jsonResponse({ ok: true });
      }
      case 'reviewer_timed_out': {
        const issueId = event.issueId as string | undefined;
        const role = event.role as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        const attempt = typeof event.attempt === 'number' ? event.attempt : undefined;
        const maxRetries = typeof event.maxRetries === 'number' ? event.maxRetries : undefined;
        const willRetry = typeof event.willRetry === 'boolean' ? event.willRetry : undefined;
        if (!issueId || !role || !sessionName || attempt === undefined || maxRetries === undefined || willRetry === undefined) {
          return jsonResponse({ ok: false, error: 'reviewer_timed_out requires issueId, role, sessionName, attempt, maxRetries, willRetry' }, 400);
        }
        notifyPipelineSync({ type: 'reviewer_timed_out', issueId, role, sessionName, attempt, maxRetries, willRetry });
        return jsonResponse({ ok: true });
      }
      case 'coordinator_started': {
        const issueId = event.issueId as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        if (!issueId || !sessionName) {
          return jsonResponse({ ok: false, error: 'coordinator_started requires issueId, sessionName' }, 400);
        }
        notifyPipelineSync({ type: 'coordinator_started', issueId, sessionName });
        return jsonResponse({ ok: true });
      }
      case 'coordinator_died': {
        const issueId = event.issueId as string | undefined;
        const sessionName = event.sessionName as string | undefined;
        const reason = event.reason as string | undefined;
        if (!issueId || !sessionName || !reason) {
          return jsonResponse({ ok: false, error: 'coordinator_died requires issueId, sessionName, reason' }, 400);
        }
        notifyPipelineSync({ type: 'coordinator_died', issueId, sessionName, reason });
        return jsonResponse({ ok: true });
      }
      default:
        return jsonResponse({ ok: false, error: `unknown pipeline event type: ${type}` }, 400);
    }
  })),
);


export const mergeOpsRouteLayer = Layer.mergeAll(
  postWorkspaceSyncMainRoute,
  postWorkspaceMergeRoute,
  postForgeApproveRoute,
  postForgeMergeRoute,
  postWorkspaceApproveRoute,
  getMergeQueueRoute,
  postInternalPipelineNotifyRoute,
);

export default mergeOpsRouteLayer;
