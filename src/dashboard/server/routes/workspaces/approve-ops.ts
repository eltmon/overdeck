/**
 * Approve-ops route module — extracted from routes/workspaces.ts (B / wave 2, seam 4b).
 *
 * Approve / forge / sync-main / merge / queue / pipeline-notify endpoints:
 *   POST /api/issues/:issueId/sync-main
 *   POST /api/issues/:issueId/merge
 *   POST /api/issues/:issueId/forge-approve
 *   POST /api/issues/:issueId/forge-merge
 *   POST /api/issues/:issueId/approve
 *   GET  /api/merge-queue
 *   POST /api/internal/pipeline/notify
 *
 * The merge engine (triggerMerge) lives in merge-ops.ts and is imported here.
 * Shared singletons stay owned by ../workspaces.js.
 */


import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { EventStoreService } from '../../services/domain-services.js';
import { gitPush, MainDivergedError } from '../../../../lib/git/operations.js';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import { resolveProjectFromIssueSync, findProjectByTeamSync } from '../../../../lib/projects.js';
import { resolveGitHubIssueSync as resolveGitHubIssueShared } from '../../../../lib/tracker-utils.js';
import { getReviewStatusSync, markWorkspaceStuck } from '../../../../lib/review-status.js';
import { listGitOperationsSync } from '../../../../lib/git-activity.js';
import { messageAgent } from '../../../../lib/agents.js';
import { syncMainIntoWorkspace } from '../../../../lib/cloister/merge-agent.js';
import { runVerificationForIssue } from '../../../../lib/cloister/verification-runner.js';
import { loadConfigSync } from '../../../../lib/config.js';
import { getWorkAgentLifecycleStateSync } from '../../../../lib/work-agent-lifecycle.js';
import { getAllActiveQueues } from '../../../../lib/overdeck/merge.js';
import { triggerMerge } from './merge-ops.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  getWorkspaceInfoForIssue,
  readJsonBody,
  spawnPanCommand,
  requireTrustedMutationOrigin,
  setReviewStatus,
  setPendingOperation,
  completePendingOperation,
  flyExecCmd,
  reconcileGitHubMergeStatus,
} from '../workspaces.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Safe `.message` read for caught values of unknown shape. */
const errorMessage = (e: unknown): string | undefined => e instanceof Error ? e.message : undefined;


export type ApprovePushResult =
  | { pushed: true }
  | { pushed: false; httpStatus: 409 | 400; error: string };

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
    const message = pushErr instanceof Error ? errorMessage(pushErr) : String(pushErr);
    const error = `Merge succeeded but push failed! Your work is safe locally.\nPlease push manually: cd ${projectPath} && git push origin main\nError: ${message}`;
    return { pushed: false, httpStatus: 400, error };
  }
}

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
        } catch (err: unknown) {
          results.push({ repoKey: repo.repoKey, approved: false, error: errorMessage(err) });
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
        } catch (err: unknown) {
          results.push({ repoKey: repo.repoKey, merged: false, error: errorMessage(err) });
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
        const mergeData = (yield* Effect.promise(() => mergeRes.json()));
        return jsonResponse(mergeData, { status: mergeRes.status });
      } catch (err: unknown) {
        return jsonResponse(
          { error: `Failed to forward to merge: ${errorMessage(err)}` },
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
        } catch (pushErr: unknown) {
          console.log(`Feature branch push note: ${errorMessage(pushErr)}`);
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
        } catch (checkoutErr: unknown) {
          const error = `Failed to checkout/update main branch: ${errorMessage(checkoutErr)}`;
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
        } catch (err: unknown) {
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
        } catch (rebaseError: unknown) {
          const error = `Server-side rebase failed: ${errorMessage(rebaseError)}\n\nResolve manually:\n  cd <workspace>\n  git rebase origin/main\n  git push --force-with-lease`;
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
            .filter((s: { success: boolean; skipped?: boolean; step: string }) => s.success && !s.skipped)
            .map((s: { success: boolean; skipped?: boolean; step: string }) => s.step)
            .join(', ')}`
        );

        if (isGitHubIssueFlag) {
          try {
            await execAsync('pan sync', { encoding: 'utf-8', timeout: 30000 });
          } catch (syncError: unknown) {
            console.error('pan sync failed (non-fatal):', errorMessage(syncError));
          }
        }

        completePendingOperation(issueId);

        return jsonResponse({
          success: true,
          message: `Approved ${issueId}: ${lifecycleResult.steps
            .filter((s: { success: boolean; skipped?: boolean; step: string }) => s.success && !s.skipped)
            .map((s: { success: boolean; skipped?: boolean; step: string }) => s.step)
            .join(', ')}${isGitHubIssueFlag ? ', skills synced' : ''}`,
        });
    });
  }))
);

const getMergeQueueRoute = HttpRouter.add(
  'GET',
  '/api/merge-queue',
  httpHandler(Effect.gen(function* () {
    const queues = getAllActiveQueues();
    return jsonResponse({ queues });
  })),
);

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


export const approveOpsRouteLayer = Layer.mergeAll(
  postWorkspaceSyncMainRoute,
  postWorkspaceMergeRoute,
  postForgeApproveRoute,
  postForgeMergeRoute,
  postWorkspaceApproveRoute,
  getMergeQueueRoute,
  postInternalPipelineNotifyRoute,
);

export default approveOpsRouteLayer;
