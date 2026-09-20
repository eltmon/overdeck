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
 *
 * Shared singletons (pending operations, project path, workspace info, readJsonBody)
 * stay owned by ../workspaces.js and are imported here.
 */
import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { syncMainIntoWorkspace } from '../../../../lib/cloister/merge-agent.js';
import { MainDivergedError, gitPush } from '../../../../lib/git/operations.js';
import { listGitOperationsSync } from '../../../../lib/git-activity.js';
import { extractNumberSync, extractPrefixSync, parseIssueIdSync } from '../../../../lib/issue-id.js';
import { enqueueMerge, getCurrentMerge, markMergeProcessing, dequeueMerge, getAllActiveQueues } from '../../../../lib/overdeck/merge.js';
import { findProjectByTeamSync } from '../../../../lib/projects.js';
import { isOverdeckOwnedOnlyStatus } from '../../../../lib/state-plane.js';
import { findPlan } from '../../../../lib/xbrief/io.js';
import { isIntegrationPermissionError, verifyAppCanMerge, type GitHubPullRequestState } from '../../../../lib/github-app.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared } from '../../../../lib/tracker-utils.js';
import { sessionExists } from '../../../../lib/tmux.js';
import { resolveIssueWorkspaceSyncTarget } from '../../../../lib/workspaces/resolver.js';
import { jsonResponse } from '../../http-helpers.js';
import { EventStoreService } from '../../services/domain-services.js';
import { clearMergeRun, getMergeRun, listMergeRuns, setMergeRun, setMergeQueueAdvanceHandler, type MergeRunPatch } from '../../services/merge-queue-service.js';
import { getDerivedIssueState } from '../../services/derived-issue-state.js';
import { httpHandler } from '../http-handler.js';
import { _serverManagedMerges } from '../specialists.js';
import { completePendingOperation, getPendingOperation, getProjectPath, getWorkspaceInfoForIssue, readJsonBody, setPendingOperation } from '../workspaces.js';
import { buildLocalMainRecoveryError } from './git-recovery-advice.js';
import { internalStrikeMergeRoute } from './internal-strike-merge.js';
import { postInternalPipelineNotifyRoute } from './internal-pipeline-notify.js';
import { activeStrikeMerge, advanceMergeQueue, mergeVerificationOptions, normalMergeEligibility, prepareWorkAgentForRebase, readStrikeHead, rebaseWithAgentFallback, validateStrikeMergeRequest, type TriggerMergeRequest, type TriggerMergeResult } from './merge-strike.js';
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Progress of the merge run this process is executing. In memory only
 * (PAN-3917 FR-12): the forge owns whether the PR merged, and
 * `services/derived-issue-state.ts` answers that. Nothing here is a status.
 */
const setStatus = (issueId: string, patch: MergeRunPatch): void => { setMergeRun(issueId, patch); };

const gitIn = async (args: string[], cwd: string): Promise<string> =>
  (await execFileAsync('git', args, { cwd, encoding: 'utf-8' })).stdout.trim();
export const shouldBlockApproveForDirtyStatus = (status: string): boolean =>
  status.trim() !== '' && !isOverdeckOwnedOnlyStatus(status);

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
  } catch (error) {
    console.warn(`[merge] Could not determine whether ${branchName} contains origin/${targetBranch}: ${error instanceof Error ? error.message : String(error)}`);
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
export async function reconcileGitHubMergeStatus(issueId: string, prUrl: string | null | undefined): Promise<boolean> {
  if (!prUrl) return false;

  const prRef = parseGitHubPullRequestUrl(prUrl);
  if (!prRef) return false;

  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../../../../lib/github-app.js');
    if (!isGitHubAppConfigured()) return false;

    const prState = await Effect.runPromise(getPullRequestState(prRef.owner, prRef.repo, prRef.number));
    console.log(`[merge] reconcileGitHubMergeStatus: ${issueId} PR #${prRef.number} merged=${prState.merged} state=${prState.state}`);
    if (!prState.merged) return false;

    setStatus(issueId, { phase: 'merged', notes: null });
    completePendingOperation(issueId, null);
    return true;
  } catch (err: any) {
    console.warn(`[merge] Failed to reconcile PR state for ${issueId}: ${err.message}`);
    return false;
  }
}


/**
 * Build a rich PR body with issue link, tasks task summary, and AC checklist
 * from the xBRIEF plan. Exported for testing.
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

  // Acceptance criteria checklist from xBRIEF plan items
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
    // No xBRIEF plan — omit checklist
  }

  return lines.join('\n') || `Automated PR for ${issueId}`;
}

export async function ensurePRExists(
  issueId: string,
  options?: { cwd?: string; branchName?: string; targetBranch?: string }
): Promise<{ created: boolean; prUrl?: string; error?: string }> {
  try {
    const issueLower = issueId.toLowerCase();
    const branchName = options?.branchName ?? `feature/${issueLower}`;
    const targetBranch = options?.targetBranch ?? 'main';
    const execOptions: Parameters<typeof execFileAsync>[2] = { encoding: 'utf-8' };
    if (options?.cwd) execOptions.cwd = options.cwd;

    // Reuse an open PR for this head/base pair, or a merged PR for terminal reconciliation.
    // A closed unmerged PR must not prevent a fresh PR for new branch commits.
    try {
      const { stdout } = await execFileAsync('gh', ['pr', 'list', '--head', branchName, '--base', targetBranch, '--state', 'all', '--json', 'url,state', '--limit', '100'], execOptions);
      const pullRequests = JSON.parse(String(stdout)) as Array<{ url?: string; state?: string }>;
      const existing = pullRequests.find(pr => pr.state === 'OPEN') ?? pullRequests.find(pr => pr.state === 'MERGED');
      if (existing?.url) return { created: false, prUrl: existing.url };
    } catch { /* no reusable PR */ }

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


export interface ApprovePushResult {
  pushed: boolean;
  httpStatus?: number;
  error?: string;
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
      // Do NOT hard-reset local main here: that is a destructive operation that
      // must be explicit/user-confirmed, not a silent side-effect of a failed push.
      // PAN-3917: the old `markWorkspaceStuck` record flag is gone. The 409 below
      // IS the signal — a diverged main leaves the merge run failed with the
      // recovery instructions, and the next attempt re-reads git, so nothing has
      // to remember that this happened.
      const error = `Push aborted: origin/main has advanced past your local ancestor (remote: ${pushErr.remoteSha?.slice(0, 7)}, local: ${pushErr.localSha?.slice(0, 7)}). A hotfix may have landed. To recover, preserve local commits: cd ${projectPath} && git fetch origin main && git merge origin/main, resolve any conflicts, then push main and retry.`;
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
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const requestedWorkspacePath = new URL(request.url, 'http://localhost').searchParams.get('workspacePath') ?? undefined;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    if (!requestedWorkspacePath && workspaceInfo.isRemote) {
      return jsonResponse(
        {
          success: false,
          error: 'Sync with Main is not supported for remote workspaces',
        },
        { status: 400 }
      );
    }

    const target = resolveIssueWorkspaceSyncTarget(issueId, projectPath, requestedWorkspacePath);
    if (!target) {
      return jsonResponse(
        { success: false, error: 'Workspace does not exist or is not owned by this issue' },
        { status: 400 }
      );
    }

    console.log(`[sync-main] Starting sync for ${issueId} at ${target.path} (${target.branchName})`);

    const result = yield* Effect.promise(() => syncMainIntoWorkspace(target.path, issueId));

    if (result.success) {
      if (result.alreadyUpToDate) {
        return jsonResponse({
          success: true,
          alreadyUpToDate: true,
          message: 'Already up to date with main', repos: result.repos,
        });
      }
      return jsonResponse({
        success: true,
        commitCount: result.commitCount || 0,
        changedFiles: result.changedFiles || [],
        message: `Synced ${result.commitCount || 0} commit(s) from main`, repos: result.repos,
      });
    } else {
      const status = result.reason?.includes('uncommitted') ? 400 : 500;
      return jsonResponse(
        {
          success: false,
          error: result.reason || 'Sync failed',
          conflictFiles: result.conflictFiles, repos: result.repos,
        },
        { status }
      );
    }
  }))
);

// ─── Shared triggerMerge logic ────────────────────────────────────────────────

// Per-project merge queue backed by SQLite (PAN-632).
// Replaces the in-memory _mergeQueues Map — survives server restarts.

/** Dequeue the next merge after current completes (success or failure). */
function dequeueNextMerge(projectKey: string, completedIssueId?: string): void {
  void advanceMergeQueue({
    dequeue: dequeueMerge,
    getDerivedState: (issueId) => getDerivedIssueState(issueId),
    getProjectPath: (issueId) => getProjectPath(undefined, extractPrefixSync(issueId) ?? issueId.split('-')[0]),
    getStrikeHead: (issueId, projectPath) => readStrikeHead(issueId, projectPath, gitIn),
    triggerMerge,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  }, projectKey, completedIssueId).catch((err: unknown) =>
    console.warn(`[merge] Queue advance failed for ${projectKey}: ${err instanceof Error ? err.message : String(err)}`),
  );
}

export async function triggerMerge(issueId: string, request: TriggerMergeRequest = { kind: 'normal' }): Promise<TriggerMergeResult> {
  // FR-9: readiness is the forge's answer — approvals, green checks, and
  // mergeability — read fresh on every attempt. Nothing is remembered between
  // attempts except the progress of a run that is currently executing.
  const derived = await getDerivedIssueState(issueId);
  const run = getMergeRun(issueId);
  if (request.kind === 'strike') {
    if (activeStrikeMerge(getCurrentMerge((extractPrefixSync(issueId) ?? issueId.split('-')[0]).toLowerCase()) === issueId.toUpperCase() ? issueId.toUpperCase() : null, getPendingOperation(issueId))) return { success: true, statusCode: 200, message: 'Strike merge already in progress', outcome: 'merging' };
    const projectPath = getProjectPath(undefined, extractPrefixSync(issueId) ?? issueId.split('-')[0]);
    const strikeError = await validateStrikeMergeRequest(issueId, request, { projectPath, git: gitIn });
    if (strikeError) {
      setStatus(issueId, { notes: strikeError });
      return { success: false, statusCode: 409, error: strikeError };
    }
  } else {
    const pendingOp = run?.phase === 'merging' ? getPendingOperation(issueId) : null;
    const ineligible = normalMergeEligibility(derived, pendingOp?.type === 'merge' && pendingOp?.status === 'running', run);
    if (ineligible) return ineligible;
  }

  if (run?.phase === 'merging') {
    const pendingOp = getPendingOperation(issueId);
    console.log(
      `[merge] Clearing a stale in-flight merge run for ${issueId} (pending op: ${pendingOp?.status ?? 'absent'})`
    );
    clearMergeRun(issueId);
  }

  if (derived.state === 'merged') {
    return { success: false, statusCode: 400, error: 'Already merged', state: 'merged' };
  }

  const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = issueId.toLowerCase();

  // Serialize merges per project via persistent SQLite queue (PAN-632).
  // Survives server restarts — no more lost queues.
  const projectKey = issuePrefix.toLowerCase();
  const normalizedId = issueId.toUpperCase();
  const currentlyMerging = getCurrentMerge(projectKey);
  if (request.kind === 'strike' && currentlyMerging === normalizedId) return { success: true, statusCode: 200, message: 'Strike merge already in progress', outcome: 'merging' };
  if (currentlyMerging && currentlyMerging !== normalizedId) {
    // Another merge is in progress — queue this one
    const position = enqueueMerge(projectKey, normalizedId);
    setStatus(issueId, { phase: 'queued', step: 'queued' });
    console.log(`[merge] Queued ${issueId} (position ${position}, waiting for ${currentlyMerging})`);
    return {
      success: true,
      statusCode: 200,
      message: `Queued for merge (position ${position}, waiting for ${currentlyMerging})`,
      outcome: 'queued',
    };
  }
  // Mark as processing IMMEDIATELY — before any async work — to prevent race conditions.
  // SQLite write is atomic — no window for concurrent calls to both pass the check.
  enqueueMerge(projectKey, normalizedId);
  markMergeProcessing(projectKey, normalizedId);

  const workspaceInfo = getWorkspaceInfoForIssue(issueId);

  // Use the actual resolved workspace path (handles legacy feature-484 naming)
  const workspacePath = request.kind === 'strike'
    ? request.workspacePath
    : (!workspaceInfo.isRemote && workspaceInfo.localPath)
      ? workspaceInfo.localPath
      : join(projectPath, 'workspaces', `feature-${issueLower}`);
  const workspaceDirName = basename(workspacePath);
  const branchName = request.kind === 'strike'
    ? request.branchName
    : workspaceDirName.startsWith('feature-')
      ? `feature/${workspaceDirName.slice('feature-'.length)}`
      : `feature/${issueLower}`;
  setStatus(issueId, { phase: 'merging', step: 'validating-pr' });
  const normalizedMergeId = issueId.toUpperCase();
  _serverManagedMerges.add(normalizedMergeId);
  setPendingOperation(issueId, 'merge');
  let queueAdvanced = false, preserveQueue = false;
  const advanceQueue = (): void => {
    if (queueAdvanced) return;
    queueAdvanced = true;
    _serverManagedMerges.delete(normalizedMergeId);
    dequeueNextMerge(projectKey, normalizedId);
  };
  try {
    if (request.kind === 'normal' && workspaceInfo.isRemote && workspaceInfo.vmName) {
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
        setStatus(issueId, { phase: 'failed', notes: error });
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

        setStatus(issueId, { phase: 'merged', notes: null });
        completePendingOperation(issueId, null);

        const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
        await postMergeLifecycle(issueId, projectPath);

        const remotePrNumber = prResult.prUrl.match(/\/pull\/(\d+)/)?.[1] ?? '?';
        return {
          success: true,
          statusCode: 200,
          message: `Successfully merged PR #${remotePrNumber} for ${issueId}`,
          outcome: 'merged',
          prUrl: prResult.prUrl,
          remote: true,
        };
      } catch (remoteErr: any) {
        const mergeErrorMessage = `Remote merge failed: ${remoteErr.message}`;
        console.error(`[merge] Remote merge failed for ${issueId}:`, remoteErr);
        setStatus(issueId, { phase: 'failed', notes: mergeErrorMessage });
        completePendingOperation(issueId, remoteErr.message);
        return {
          success: false,
          statusCode: 500,
          error: mergeErrorMessage,
        };
      }
    }
    const projectConfig = findProjectByTeamSync(issuePrefix);
    const isPolyrepo = projectConfig?.workspace?.type === 'polyrepo';
    if (!existsSync(workspacePath)) {
      const error = 'Workspace does not exist';
      const retryable = request.kind === 'normal' && !workspaceInfo.isRemote && !isPolyrepo;
      if (retryable) setStatus(issueId, { phase: 'queued', notes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: retryable ? 500 : 400, error, ...(retryable ? { retryable: true } : {}) };
    }
    if (isPolyrepo && projectConfig?.workspace?.repos) {
      console.log(`[merge] Polyrepo detected for ${issueId}, coordinating merge set...`);
      const { getMergeSetSync, ensureMergeSetForIssueSync, upsertMergeSetSync, withRepoStateSync } = await import('../../../../lib/merge-set.js');
      const { runQualityGates } = await import('../../../../lib/cloister/validation.js');
      const { assessRepoMergeCompleteness } = await import('../../../../lib/cloister/merge-completeness.js');
      const { getForgeAdapter } = await import('../../../../lib/forge.js');
      const { messageAgent } = await import('../../../../lib/agents.js');
      let mergeSet = getMergeSetSync(issueId) || ensureMergeSetForIssueSync(issueId);
      if (!mergeSet) {
        const error = `No merge set found for ${issueId}`;
        setStatus(issueId, { phase: 'failed', notes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error };
      }

      // PAN-3917: which repos still need merging is asked of the forge and git
      // HERE, on every attempt — nothing writes a verdict for a later pass to
      // read back. Only a required repo with no review artifact can block the
      // set; one that HAS an artifact is simply not merged yet, which is what
      // this run is for.
      const blockers: string[] = [];
      const alreadyLanded = new Set<string>();
      for (const repo of mergeSet.repos.filter(candidate => candidate.required)) {
        if (!repo.artifactUrl) {
          let discovered: { url?: string; id?: string } | null = null;
          try {
            discovered = await getForgeAdapter(repo.forge).discoverArtifact({ sourceBranch: repo.sourceBranch, cwd: repo.repoPath });
          } catch (discoverErr: any) {
            blockers.push(`${repo.repoKey} artifact discovery is unverifiable: ${discoverErr?.message ?? String(discoverErr)}`);
            continue;
          }
          if (discovered?.url) {
            mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { artifactUrl: discovered.url, artifactId: discovered.id });
            continue;
          }
        }
        const assessed = await assessRepoMergeCompleteness(repo);
        if (assessed.state === 'merged' || assessed.state === 'no-changes') {
          alreadyLanded.add(repo.repoKey);
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, assessed.state === 'merged'
            ? { repoMerge: 'merged', ...(assessed.artifactUrl ? { artifactUrl: assessed.artifactUrl, artifactId: assessed.artifactId } : {}) }
            : { repoMerge: 'skipped' });
        } else if (!repo.artifactUrl) {
          blockers.push(assessed.reason);
        }
      }

      if (blockers.length > 0) {
        const error = blockers.join('; ');
        mergeSet = { ...mergeSet, status: 'failed', updatedAt: new Date().toISOString() };
        upsertMergeSetSync(mergeSet);
        setStatus(issueId, { phase: 'failed', notes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 409, error };
      }
      upsertMergeSetSync(mergeSet);

      const activeRepos = mergeSet.repos
        .filter(repo => !alreadyLanded.has(repo.repoKey) && !!repo.artifactUrl)
        .sort((a, b) => a.mergeOrder - b.mergeOrder);

      if (activeRepos.length === 0) {
        mergeSet = { ...mergeSet, status: 'merged', updatedAt: new Date().toISOString() };
        upsertMergeSetSync(mergeSet);
        setStatus(issueId, {
          phase: 'merged', notes: null
        });
        completePendingOperation(issueId, null);
        const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
        advanceQueue();
        await postMergeLifecycle(issueId, projectPath);
        return {
          success: true, statusCode: 200, message: `No changed repos remain for ${issueId}`,
          outcome: 'merged', repos: [],
        };
      }

      const agentId = `agent-${issueId.toLowerCase()}`;

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
      // PAN-2461: repos whose source branch already contains the target branch need no
      // rebase round-trip — a retry after the work agent already rebased+pushed must not
      // wait 30 minutes for a push that will never come (mirrors the monorepo
      // "already contains origin/main" skip).
      const alreadyRebased = new Set<string>();

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
        try {
          await execAsync(`git fetch origin ${repo.targetBranch} ${repo.sourceBranch}`, {
            cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 30000,
          });
          await execAsync(
            `git merge-base --is-ancestor origin/${repo.targetBranch} origin/${repo.sourceBranch}`,
            { cwd: repoWorkspacePath, encoding: 'utf-8', timeout: 10000 }
          );
          alreadyRebased.add(repo.repoKey);
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { rebaseStatus: 'passed' });
          console.log(`[merge] ${repo.repoKey} feature branch already contains origin/${repo.targetBranch} — skipping rebase request for ${issueId}`);
          continue;
        } catch {
          // Not an ancestor (or fetch failed) — a rebase is genuinely required.
        }
        mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { rebaseStatus: 'requested' });
      }
      upsertMergeSetSync(mergeSet);

      if (mergeResults.some(result => !result.success)) {
        const failedDetails = mergeResults.filter(r => !r.success).map(r => `${r.repo}: ${r.message}`).join('; ');
        const error = `Polyrepo merge prerequisites failed for ${issueId}: ${failedDetails}`;
        setStatus(issueId, { phase: 'failed', notes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 400, error, repos: mergeResults };
      }

      const reposNeedingRebase = activeRepos.filter(repo => !alreadyRebased.has(repo.repoKey));

      if (reposNeedingRebase.length > 0) {
        const rebaseInstructions = reposNeedingRebase.map((repo, index) => (
          `${index + 1}. cd ${repo.repoKey}\n   git fetch origin ${repo.targetBranch}\n   git rebase origin/${repo.targetBranch}\n   git push --force-with-lease`
        )).join('\n');
        const rebaseMsg = `MERGE REQUESTED: The human has clicked MERGE for ${issueId}. Rebase and push every affected repo in this merge set:\n\n${rebaseInstructions}\n\nResolve any conflicts in the workspaces above, complete every rebase, and push all affected branches. Do NOT merge PRs/MRs yourself.`;

        // PAN-3120: a polyrepo merge needs the work agent to rebase every repo,
        // and the scheduler routinely yields idle work agents to free slots — so
        // refusing here made a system-chosen pause look like an operator dead
        // end. Resume it (same recovery the single-repo path uses) and say so.
        const prep = await prepareWorkAgentForRebase({ issueId, workspacePath, agentId, rebaseMsg, scopeNote: `${reposNeedingRebase.length} repo(s)`, setStatus: u => setStatus(issueId, u) });
        if (!prep.ok) {
          completePendingOperation(issueId, prep.error);
          return { success: false, statusCode: 400, error: prep.error };
        }
      }

      const REBASE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — complex polyrepo rebases need time for conflict resolution
      const POLL_INTERVAL_MS = 5000;
      const pushedRepos = new Set<string>(alreadyRebased);
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
        setStatus(issueId, { phase: 'failed', notes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error };
      }

      setStatus(issueId, { phase: 'verifying', notes: null });
      // PAN-2461: gates must run with rendered placeholders and the workspace ROOT.
      // The previous call passed the repo subdir (doubling gate.path → <ws>/fe/fe)
      // and no placeholders (docker exec hit the literal "myn-{{FEATURE_FOLDER}}-fe-1").
      const featureFolder = basename(workspacePath);
      const gatePlaceholders = {
        FEATURE_NAME: featureFolder.replace(/^feature-/, ''),
        FEATURE_FOLDER: featureFolder,
        BRANCH_NAME: `feature/${featureFolder.replace(/^feature-/, '')}`,
        COMPOSE_PROJECT: `${basename(projectPath)}-${featureFolder}`,
        DOMAIN: projectConfig?.workspace?.dns?.domain || 'localhost',
        PROJECT_NAME: basename(projectPath),
        PROJECT_PATH: projectPath,
        PROJECTS_DIR: dirname(projectPath),
        WORKSPACE_PATH: workspacePath,
      };

      for (const repo of activeRepos) {
        const repoConfig = projectConfig.workspace.repos.find(configRepo => configRepo.name === repo.repoKey);
        const gateIdentifiers = new Set<string>([
          repo.repoKey,
          repoConfig?.path || '',
        ].filter(Boolean));
        const gates = Object.fromEntries(
          Object.entries(projectConfig.quality_gates || {}).filter(
            ([, gate]) => gate.path && gateIdentifiers.has(gate.path)
          )
        );

        mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoVerification: 'running' });
        upsertMergeSetSync(mergeSet);

        if (Object.keys(gates).length === 0) {
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoVerification: 'skipped' });
          upsertMergeSetSync(mergeSet);
          continue;
        }

        const gateResults = await Effect.runPromise(runQualityGates(gates, workspacePath, 'pre_push', {
          placeholders: { ...gatePlaceholders, CHANGED_BASE: `origin/${repo.targetBranch}` },
        }));
        const failedGate = gateResults.find(result => !result.passed && result.required !== false);
        if (failedGate) {
          const error = `Polyrepo post-rebase verification failed for ${repo.repoKey} at ${failedGate.name}`;
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoVerification: 'failed' });
          upsertMergeSetSync(mergeSet);
          setStatus(issueId, { phase: 'failed', notes: error });
          completePendingOperation(issueId, error);
          return { success: false, statusCode: 500, error };
        }

        mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoVerification: 'passed' });
        upsertMergeSetSync(mergeSet);
      }

      setStatus(issueId, { phase: 'merging' });
      for (const repo of activeRepos) {
        const repoWorkspacePath = join(workspacePath, repo.repoKey);
        try {
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'merging' });
          upsertMergeSetSync(mergeSet);
          await getForgeAdapter(repo.forge).mergeReviewArtifact({
            forge: repo.forge,
            url: repo.artifactUrl,
            id: repo.artifactId,
            cwd: repoWorkspacePath,
            method: 'squash',
          });
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'merged' });
          upsertMergeSetSync(mergeSet);
          mergeResults.push({
            repo: repo.repoKey,
            success: true,
            message: `Merged via ${repo.forge}`,
          });
        } catch (mergeErr: any) {
          const error = mergeErr.message || 'Artifact merge failed';
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'failed' });
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
        setStatus(issueId, { phase: 'failed', notes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error, repos: mergeResults };
      }

      mergeSet = {
        ...mergeSet,
        status: 'merged',
        updatedAt: new Date().toISOString(),
      };
      upsertMergeSetSync(mergeSet);
      setStatus(issueId, { phase: 'merged', notes: null });
      completePendingOperation(issueId, null);

      const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
      advanceQueue();
      await postMergeLifecycle(issueId, projectPath);

      return {
        success: true,
        statusCode: 200,
        message: `Polyrepo merge complete for ${issueId}`,
        outcome: 'merged',
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
      setStatus(issueId, { phase: 'failed', notes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: 400, error };
    }

    const artifactUrl = primaryRepo?.artifactUrl || prResult.prUrl;
    const artifactId = primaryRepo?.artifactId;
    const githubPrRef = primaryForge === 'github' ? parseGitHubPullRequestUrl(artifactUrl) : null;
    const prNumber = githubPrRef ? String(githubPrRef.number) : undefined;
    if (primaryForge === 'github' && !prNumber) {
      const error = `Could not parse PR number from URL: ${artifactUrl}`;
      setStatus(issueId, { phase: 'failed', notes: error });
      completePendingOperation(issueId, error);
      return { success: false, statusCode: 400, error };
    }

    let preMergePrState: GitHubPullRequestState | undefined;
    // Reject stale prUrl state from cancel-flow or manual closure before rebase/merge (PAN-509).
    if (githubPrRef) {
      try {
        const { getPullRequestState, isGitHubAppConfigured } = await import('../../../../lib/github-app.js');
        if (isGitHubAppConfigured()) {
          const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
          preMergePrState = prState;
          if (prState.state !== 'OPEN' && !prState.merged) {
            const error = `PR #${githubPrRef.number} is ${prState.state} (not OPEN). Overdeck state is out of sync — likely a cancel-flow left a stale prUrl. Re-open the work agent to create a fresh PR, or reset review state.`;
            console.error(`[merge] ${error}`);
            setStatus(issueId, { phase: 'failed', notes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          // Surface failing required checks before branch protection turns them into a generic merge error
          // (PAN-611/PAN-544).
          if (prState.checksFailed && !prState.merged) {
            const error = `GitHub PR #${githubPrRef.number} has failing required checks on HEAD ${prState.headSha.slice(0, 8)}. Fix CI before merging — see ${prState.url || 'the PR page'} for details.`;
            console.error(`[merge] ${error}`);
            setStatus(issueId, { phase: 'failed', notes: error });
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
            setStatus(issueId, { phase: 'failed', notes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 409, error };
          }
          if (prState.merged) {
            console.log(`[merge] PR #${githubPrRef.number} for ${issueId} is already merged — running post-merge lifecycle`);
            setStatus(issueId, { phase: 'merged', notes: null });
            completePendingOperation(issueId, null);
            const { postMergeLifecycle } = await import('../../../../lib/cloister/merge-agent.js');
            await postMergeLifecycle(issueId, projectPath, branchName);
            return {
              success: true,
              statusCode: 200,
              message: `PR #${githubPrRef.number} for ${issueId} was already merged`,
              outcome: 'merged',
              prUrl: prResult.prUrl,
            };
          }
        }
      } catch (prStateErr: any) {
        console.warn(`[merge] Pre-merge PR state check failed for ${issueId}: ${prStateErr.message} — proceeding (check is best-effort)`);
      }
    }

    const { postMergeLifecycle } = await import(
      '../../../../lib/cloister/merge-agent.js'
    );
    const { beginShipLog, appendShipLog } = await import('../../../../lib/cloister/ship-log.js');
    let rebaseResult: { success: boolean; reason?: string; conflictFiles?: string[]; newHead?: string; retryable?: boolean } | undefined;
    const canMergeCleanPrDirectly = preMergePrState?.mergeable === true && preMergePrState.mergeableState === 'clean' && !preMergePrState.checksFailed && !preMergePrState.checksPending && !preMergePrState.draft && !preMergePrState.merged;

    if (canMergeCleanPrDirectly) {
      console.log(`[merge] PR is CLEAN — merging directly without rebase for ${issueId}`);
      rebaseResult = { success: true, newHead: preMergePrState!.headSha };
    } else {
      const agentId = request.kind === 'strike' ? request.recoveryTarget : `agent-${issueId.toLowerCase()}`;
      const rebaseMsg = request.kind === 'strike'
        ? `STRIKE LANDING REQUEST: Rebase ${branchName} onto ${targetBranch}, resolve conflicts, run the full quality gates, push ${branchName}, then run pan strike-ready ${issueId} to persist the new HEAD. Do NOT merge or push main.`
        : `MERGE REQUESTED: The human has clicked MERGE for ${issueId}. Please rebase onto ${targetBranch} and push:\n\n1. git fetch origin ${targetBranch}\n2. git rebase origin/${targetBranch}\n3. If conflicts: resolve them, git add, git rebase --continue\n4. git push --force-with-lease\n\nAfter pushing, the server will handle verification and merge automatically. Do NOT run gh pr merge yourself.`;

      setStatus(issueId, { step: 'rebasing' });
      console.log(`[merge] Rebasing ${branchName} onto ${targetBranch} for ${issueId} (agent=${await Effect.runPromise(sessionExists(agentId)) ? 'running' : 'stopped'})...`);
      beginShipLog(issueId);
      appendShipLog(issueId, `Ship started: rebasing ${branchName} onto ${targetBranch}…`, 'rebasing');

      // Pre-check: if origin/<branch> already contains origin/<target>, the branch
      // is already rebased — no rebase or push is needed.
      const { alreadyRebased, currentHead } = await isBranchAlreadyRebased(workspacePath, branchName, targetBranch);

      if (alreadyRebased && currentHead) {
        console.log(`[merge] ${branchName} already contains origin/${targetBranch} — skipping rebase request for ${issueId}`);
        rebaseResult = { success: true, newHead: currentHead };
      } else {
        rebaseResult = await rebaseWithAgentFallback({
          issueId,
          workspacePath,
          branchName,
          targetBranch,
          agentId,
          rebaseMsg,
          allowFreshStart: request.kind !== 'strike',
          setStatus: update => setStatus(issueId, update),
        });
      }
    }

    if (!rebaseResult) throw new Error(`Rebase escalation produced no result for ${issueId}`);
    if (!rebaseResult.success) {
      const error = rebaseResult.reason || 'Rebase failed';
      if (rebaseResult.retryable) {
        setStatus(issueId, { phase: 'queued', notes: error });
        completePendingOperation(issueId, error);
        return { success: false, statusCode: 500, error, retryable: true };
      }
      setStatus(issueId, { phase: 'failed', notes: error });
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

    setStatus(issueId, { step: 'stripping-planning' });
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

    // Step 3: Post-rebase verification gate ensures the rebase remains valid before merging.
    setStatus(issueId, { phase: 'verifying', step: 'verifying', notes: null });

    // PAN-2487: skip redundant local gates when CI is green on this exact tip.
    // A rebase produces a new SHA and an interrupted worker has no terminal
    // result, so both cases still require local verification.
    // PAN-3917: the "fresh terminal verification" guard keyed off the record's
    // stored verification status of `running`. With no record there is no interrupted
    // marker to carry across attempts — an interrupted run simply is not green
    // on the tip, so the CI check below already refuses to skip.
    let skipLocalVerification = false;
    if (primaryForge === 'github' && artifactUrl) {
      try {
        const { parsePullRequestRef, getCiCheckRunsStatePromise, isGitHubAppConfigured } = await import('../../../../lib/github-app.js');
        if (isGitHubAppConfigured()) {
          const ref = parsePullRequestRef({ url: artifactUrl });
          if (ref) {
            const { stdout: tipShaRaw } = await execAsync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf-8', timeout: 10000 });
            const tipSha = tipShaRaw.trim();
            const ci = await getCiCheckRunsStatePromise(ref.owner, ref.repo, tipSha);
            if (ci.green && ci.total > 0) {
              skipLocalVerification = true;
              console.log(`[merge] CI is green on ${tipSha.slice(0, 8)} (${ci.successCount}/${ci.total} checks) — skipping redundant local verification for ${issueId} (PAN-2487)`);
              setStatus(issueId, { notes: `Local verification skipped: CI green on ${tipSha.slice(0, 8)} (${ci.successCount}/${ci.total} checks)` });
            } else {
              console.log(`[merge] CI on tip not green (verdict=${ci.verdict}, total=${ci.total}) — running local verification for ${issueId}`);
            }
          }
        }
      } catch (ciErr: any) {
        console.warn(`[merge] CI-state check failed (${ciErr.message?.slice(0, 120)}) — falling back to local verification for ${issueId}`);
      }
    }
    if (skipLocalVerification) appendShipLog(issueId, '✓ Local verification skipped — CI already green on this exact commit', 'verifying');
    const verifyResult = skipLocalVerification
      ? { outcome: 'passed' as const }
      : await (async () => {
        console.log(`[merge] Running post-rebase verification for ${issueId}...`);
        appendShipLog(issueId, 'Running post-rebase verification (full quality-gate suite)…', 'verifying');
        const { runVerificationForIssue } = await import('../../../../lib/cloister/verification-runner.js');
        return Effect.runPromise(runVerificationForIssue(issueId, workspacePath, { isRemote: false }, 'merge-verify',
          { ...mergeVerificationOptions(request), onGateLog: (line) => appendShipLog(issueId, line, 'verifying') },
        ));
      })();
    // Inlined from lib/cloister/merge-verification.ts: that helper's whole body
    // was a review-status record write (PAN-3917).
    const verificationDeferral = verifyResult.outcome === 'deferred'
      ? (() => {
        const message = `Post-rebase verification deferred: ${verifyResult.reason} — merge retries after the deploy.`;
        appendShipLog(issueId, message, 'verifying');
        setStatus(issueId, { phase: 'queued', step: 'queued', notes: message });
        completePendingOperation(issueId, message);
        return { success: false as const, statusCode: 409, error: message, deferred: true, outcome: 'queued' as const };
      })()
      : null;
    if (verificationDeferral) {
      markMergeProcessing(projectKey, normalizedId, false);
      _serverManagedMerges.delete(normalizedMergeId);
      preserveQueue = true;
      return verificationDeferral;
    }
    if (verifyResult.outcome === 'failed') {
      const error = `Post-rebase verification failed at ${verifyResult.failedCheck}`;
      console.log(`[merge] ${error}`);
      setStatus(issueId, { phase: 'failed', notes: error });
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
    setStatus(issueId, { step: 'reporting-statuses' });
    try {
      const { getPullRequestState, isGitHubAppConfigured, reportCommitStatus } = await import('../../../../lib/github-app.js');
      if (githubPrRef && isGitHubAppConfigured()) {
        const prState = await Effect.runPromise(getPullRequestState(githubPrRef.owner, githubPrRef.repo, githubPrRef.number));
        const sha = prState.headSha.trim();
        if (sha) {
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'overdeck/review', 'Review passed');
          // PAN-3847: the description states what backed the stamp — the merge
          // path's own post-rebase gate, not the pre-review verification run.
          await reportCommitStatus(githubPrRef.owner, githubPrRef.repo, sha, 'success', 'overdeck/test', 'Merge path: CI green');
          console.log(`[merge] Reported commit statuses on post-rebase HEAD for ${issueId} (${sha.slice(0, 8)})`);
        }
      }
    } catch (statusErr: any) {
      console.warn(`[merge] Failed to report commit statuses: ${statusErr.message}`);
    }

    // Step 4b: Merge the review artifact via the configured forge.
    setStatus(issueId, { step: 'squash-merging' });
    appendShipLog(issueId, `Verification passed — squash-merging the ${primaryForge} PR…`, 'squash-merging');
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

        if (isIntegrationPermissionError(prMergeErr.message)) {
          let scopes = 'pull_requests:write, contents:write';
          try {
            const cap = await verifyAppCanMerge();
            if (cap.missing && cap.missing.length > 0) {
              scopes = cap.missing.join(', ');
            }
          } catch (permCheckErr: any) {
            console.warn(`[merge] verifyAppCanMerge failed for ${issueId}: ${permCheckErr.message}`);
          }
          const note = `GitHub App cannot merge — installation is missing ${scopes}. Grant these scopes to the overdeck-agent installation, then re-merge.`;
          setStatus(issueId, { phase: 'failed', notes: note });
          completePendingOperation(issueId, note);
          return { success: false, statusCode: 403, error: note };
        }

        const isTransient =
          prMergeErr.message?.includes('Timed out waiting for GitHub PR') ||
          prMergeErr.message?.includes('ECONNRESET') ||
          prMergeErr.message?.includes('ETIMEDOUT') ||
          prMergeErr.message?.includes('ECONNREFUSED');
        if (isTransient) {
          const reconciled = await reconcileGitHubMergeStatus(issueId, (await getDerivedIssueState(issueId)).pr?.url);
          if (reconciled) {
            artifactMerged = true;
            console.log(`[merge] Reconciliation confirmed PR merged for ${issueId} after transient error; proceeding to success path`);
          } else {
            setStatus(issueId, { phase: 'verifying', notes: error });
            completePendingOperation(issueId, error);
            return { success: false, statusCode: 500, error };
          }
          // The forge is re-read on the next attempt, so nothing has to be held
          // open here while reconciliation catches up or the operator retries.
        } else {
          setStatus(issueId, { phase: 'failed', notes: error });
          completePendingOperation(issueId, error);
          return { success: false, statusCode: 500, error };
        }
      }
    }

    // Step 5: Mark merged and dequeue next BEFORE post-merge lifecycle.
    // postMergeLifecycle spawns a deploy script that may kill this server process,
    // so queue processing must happen before that point.
    appendShipLog(issueId, `✓ MERGED — running post-merge cleanup (labels, docker teardown, verify-on-main)`, 'post-merge-cleanup');
    setStatus(issueId, { phase: 'merged', step: 'post-merge-cleanup', notes: null });
    completePendingOperation(issueId, null);

    // Dequeue next merge before lifecycle (which may kill the process)
    advanceQueue();

    // Post-merge lifecycle runs last — may spawn deploy script that kills this server
    await postMergeLifecycle(issueId, projectPath, branchName);

    return {
      success: true,
      statusCode: 200,
      message: `Successfully merged ${primaryForge} review artifact for ${issueId}`,
      outcome: 'merged',
      prUrl: prResult.prUrl,
    };
  } catch (error: any) {
    const mergeErrorMessage = `Merge pipeline error: ${error.message}`;
    console.error(`[merge] Error for ${issueId}:`, error);
    setStatus(issueId, { phase: 'failed', notes: mergeErrorMessage });
    completePendingOperation(issueId, error.message);
    return { success: false, statusCode: 500, error: error.message };
  } finally {
    if (!preserveQueue) advanceQueue();
  }
}

setMergeQueueAdvanceHandler((projectKey) => dequeueNextMerge(projectKey));

const postInternalStrikeMergeRoute = internalStrikeMergeRoute(triggerMerge);

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
        if (repo.repoMerge === 'merged' || repo.repoMerge === 'skipped') {
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

      const { assessRepoMergeCompleteness } = await import('../../../../lib/cloister/merge-completeness.js');
      let mergeSet = getMergeSetSync(issueId);
      if (!mergeSet) {
        return jsonResponse({ error: `No merge set found for ${issueId}` }, { status: 404 });
      }

      const results: Array<{ repoKey: string; merged: boolean; error?: string }> = [];
      for (const repo of mergeSet.repos) {
        if (repo.repoMerge === 'merged' || repo.repoMerge === 'skipped') {
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
            artifactUrl = discovered?.url;
            artifactId = discovered?.id;
          } catch {
            // The completeness assessor below fails closed when forge state is unavailable.
          }

          if (artifactUrl || artifactId) {
            mergeSet = withRepoArtifactUrlSync(mergeSet, repo.repoKey, artifactUrl ?? '', artifactId);
            upsertMergeSetSync(mergeSet);
            console.log(`[forge-merge] Discovered artifact for ${issueId}/${repo.repoKey}: ${artifactUrl}`);
          } else {
            const classification = await assessRepoMergeCompleteness(repo);
            if (classification.state === 'merged') {
              mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'merged' });
              results.push({ repoKey: repo.repoKey, merged: true });
            } else if (classification.state === 'no-changes') {
              mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'skipped' });
              results.push({ repoKey: repo.repoKey, merged: true });
            } else {
              mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'blocked' });
              results.push({ repoKey: repo.repoKey, merged: false, error: classification.reason });
            }
            upsertMergeSetSync(mergeSet);
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
          mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { repoMerge: 'merged' });
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

    // FR-9: "already reviewed and green" is the forge's answer, not a record's.
    const derivedForApprove = yield* Effect.promise(() => getDerivedIssueState(issueId));
    if (derivedForApprove.state === 'ready') {
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
          // STATE-PLANE-COMMIT-POLICY rules 3/6: state-plane-only dirt is not agent work.
          if (shouldBlockApproveForDirtyStatus(status)) {
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
          // Detect local-only main commits without silently hard-resetting.
          const { stdout: divergenceRaw } = await execAsync(
            'git rev-list --left-right --count HEAD...origin/main',
            { cwd: projectPath, encoding: 'utf-8' }
          );
          const [aheadRaw = '0', behindRaw = '0'] = divergenceRaw.trim().split(/\s+/);
          const aheadCount = parseInt(aheadRaw, 10) || 0;
          const behindCount = parseInt(behindRaw, 10) || 0;
          if (aheadCount > 0) {
            const error = buildLocalMainRecoveryError(projectPath, aheadCount, behindCount);
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
            prUrl: (await getDerivedIssueState(issueId)).pr?.url,
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
        // origin with --force-with-lease; the Merge button then renders because
        // the issue derives to `ready` from the forge. On conflict the operator
        // resolves manually in the workspace and re-requests review.
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
    // PAN-3917: the live step tracker used to read the merge status, step, and
    // notes off each issue's review-status record. Those were the
    // progress of a merge run this process is executing, so they are served
    // from the in-memory run map instead — one entry per run, and nothing
    // survives a restart.
    return jsonResponse({ queues, runs: listMergeRuns() });
  })),
);



export const mergeOpsRouteLayer = Layer.mergeAll(
  postWorkspaceSyncMainRoute,
  postWorkspaceMergeRoute,
  postForgeApproveRoute,
  postForgeMergeRoute,
  postWorkspaceApproveRoute,
  getMergeQueueRoute,
  postInternalStrikeMergeRoute,
  postInternalPipelineNotifyRoute,
);

export default mergeOpsRouteLayer;
