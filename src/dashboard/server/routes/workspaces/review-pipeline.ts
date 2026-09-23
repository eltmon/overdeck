/**
 * Review-pipeline route module — extracted from routes/workspaces.ts (B / wave 2, seam 3a).
 *
 * Review dispatch endpoints (start / re-run the review+test pipeline):
 *   POST /api/review/:issueId/trigger
 *   POST /api/review/:issueId/request
 *
 * Release read endpoint:
 *   GET  /api/workspaces/:issueId/release
 *
 * `startRequestReviewPipeline` is the door behind the request route, registered
 * on `cloister/request-review-pipeline.ts` so the GitHub webhook can start the
 * same pipeline for a PR opened or readied by hand (PAN-3917 W12).
 *
 * The cancel routes (purge, abort, pending) live in review-control.ts. Shared
 * singletons (pending-ops cluster, project path, readJsonBody, workspace info,
 * flyExecCmd) stay owned by ../workspaces.js.
 *
 * PAN-3917 (FR-7, FR-8): these routes dispatch; they no longer keep score. A
 * review verdict is a PR review, so every "has this been reviewed?" question
 * goes to `services/derived-issue-state.ts` and no handler writes a status
 * row. Verification writes `verification-latest.json` and a check run; its
 * failure reason reaches the operator through the pending-operation channel
 * the dashboard already streams, not through `reviewNotes`.
 */

import { exec } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import type { DerivedIssueState } from '@overdeck/contracts';

import { parseIssueIdSync, extractPrefixSync, resolveIssueIdSync } from '../../../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { EventStoreService } from '../../services/domain-services.js';
import { getDerivedIssueState } from '../../services/derived-issue-state.js';
import { getReleaseSetSync } from '../../../../lib/release-set.js';
import { getCachedConflictGateMergeability } from '../../../../lib/cloister/conflict-gate.js';
import { transitionIssueToInReview } from '../../../../lib/agents.js';
import { runVerificationForIssue } from '../../../../lib/cloister/verification-runner.js';
import { pushLocalReviewBranches } from '../../../../lib/cloister/review-branch-push.js';
import {
  registerRequestReviewStarter,
  requestReviewPipeline,
  type RequestReviewSource,
  type StartRequestReviewOutcome,
} from '../../../../lib/cloister/request-review-pipeline.js';
import { appendPipelineEntry } from '../../../../lib/cloister/pipeline-journal.js';
import { jsonResponse } from '../../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from '../dashboard-auth.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  readJsonBody,
  getWorkspaceInfoForIssue,
  setPendingOperation,
  completePendingOperation,
  clearPendingOperation,
  flyExecCmd,
  type WorkspaceInfo,
} from '../workspaces.js';

const execAsync = promisify(exec);
const MAX_AUTO_REQUEUE = 25;

const pushRemoteReviewBranch = async (vmName: string, workspacePath: string, branchName: string): Promise<void> => {
  const command = `cd ${workspacePath} && GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true SSH_ASKPASS=true git push origin ${branchName}`;
  await execAsync(flyExecCmd(vmName, command), { encoding: 'utf-8', timeout: 30_000 });
};

/** Push the verified branch, wherever the workspace lives. */
async function pushReviewBranch(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  branchName: string,
): Promise<void> {
  if (workspaceInfo.isRemote && workspaceInfo.vmName) {
    await pushRemoteReviewBranch(workspaceInfo.vmName, workspacePath, branchName);
    return;
  }
  await pushLocalReviewBranches(issueId, workspacePath);
}

/**
 * How many times an agent has automatically re-requested review this process.
 * A circuit breaker against a work agent looping on `/request`; it is a
 * counter of requests to THIS server, not a status, so it lives in memory and
 * resets with the process (PAN-3917 — nothing derivable is stored).
 */
const autoRequeueCounts = new Map<string, number>();

/** Test seam: forget every re-request count. */
export function _resetAutoRequeueCountsForTests(): void {
  autoRequeueCounts.clear();
}
/** Safe `.message` read for caught values of unknown shape. */
const errorMessage = (e: unknown): string | undefined => e instanceof Error ? e.message : undefined;

export function parseRequestedReviewMode(body: unknown):
  | { ok: true; mode?: 'quick' | 'full' | 'none' }
  | { ok: false; error: string } {
  const reviewMode = typeof body === 'object' && body !== null
    ? (body as { reviewMode?: unknown }).reviewMode
    : undefined;

  if (reviewMode === undefined || reviewMode === null) {
    return { ok: true };
  }
  if (reviewMode === 'quick' || reviewMode === 'full' || reviewMode === 'none') {
    return { ok: true, mode: reviewMode };
  }
  return { ok: false, error: 'reviewMode must be quick, full, or none' };
}

/**
 * Push the feature branch of every repo in the workspace (PAN-2948).
 *
 * A polyrepo workspace root is a one-commit wrapper repo with no remote and no
 * feature branch — pushing there fails and, on the verified-dispatch path,
 * kills the whole re-review pipeline. Loop the resolved repo roots instead
 * (mirrors rebase-helper.ts), skipping repos whose feature branch doesn't
 * exist locally (untouched sub-repos). Monorepo resolves to a single root at
 * the workspace path, preserving the previous behavior.
 */
async function pushFeatureBranches(issueId: string, workspacePath: string): Promise<void> {
  await pushLocalReviewBranches(issueId, workspacePath);
}

/**
 * A forced review request on an already-approved PR is a full rerun (reset the
 * pipeline and dispatch again) rather than a no-op. PAN-3917: "already made
 * progress past review" is now visible in the derived state — the PR carries
 * an approval, or it has moved on to ready/merged.
 */
export function shouldTreatAsRerun(derived: DerivedIssueState): boolean {
  return derived.state === 'ready'
    || derived.state === 'merged'
    || derived.pr?.reviewState === 'approved';
}

export function getDirtyWorkspaceErrorForReviewRequestStatus(
  status: string,
  workspacePath: string,
): string | null {
  // PAN-3917: there is no state plane in the workspace any more — `.pan/` is
  // tracked repo content the agent commits itself (FR-2). So any dirt is the
  // agent's uncommitted work, and reviewers only ever see committed HEAD.
  if (!status.trim()) {
    return null;
  }

  return `Workspace has uncommitted changes. Commit the changes, explicitly discard them, or surface them to the operator before requesting review:\ncd ${workspacePath}\ngit status`;
}

async function getDirtyWorkspaceErrorForReviewRequest(
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
): Promise<string | null> {
  try {
    const statusCmd = 'git status --porcelain -uno';
    const status = workspaceInfo.isRemote && workspaceInfo.vmName
      ? (await execAsync(
          flyExecCmd(workspaceInfo.vmName, `cd ${workspacePath} && ${statusCmd}`),
          { encoding: 'utf-8', timeout: 30000 },
        )).stdout
      : (await execAsync(statusCmd, { cwd: workspacePath, encoding: 'utf-8' })).stdout;

    return getDirtyWorkspaceErrorForReviewRequestStatus(status, workspacePath);
  } catch {
    return null;
  }
}

/**
 * PAN-3847 (FR-16), re-pointed for PAN-3917: a re-review request is refused
 * when the working tree is dirty (reviewers only see committed HEAD), or when
 * the PR already carries an approval that the forge has not dismissed — the
 * forge dismisses an approval when new commits land, so a standing approval
 * means there is nothing new to review.
 */
export async function reReviewGuardError(
  issueId: string,
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
  derived: DerivedIssueState | null | undefined,
): Promise<{ error: string; hint: string } | null> {
  const dirtyError = await getDirtyWorkspaceErrorForReviewRequest(workspacePath, workspaceInfo);
  if (dirtyError) {
    return {
      error: 'working tree is dirty',
      hint: 'Commit or discard changes, push, then request review again. Reviewers only see committed HEAD.',
    };
  }
  if (derived?.pr?.reviewState === 'approved') {
    return {
      error: 'HEAD already approved',
      hint: `PR #${derived.pr.number} is approved at its current head and nothing has changed since.`,
    };
  }
  return null;
}

/**
 * The one door that starts "verify → push → review" for an issue (PAN-3917
 * W12). `POST /api/review/:issueId/request` is one caller; the GitHub webhook
 * that sees a PR opened or readied by hand is the other, so a pull request
 * gets reviewed whoever opened it. `requestReviewPipeline` coalesces, so two
 * callers for the same issue cost one run.
 *
 * It resolves the workspace, refuses a dirty tree, and hands the verification
 * continuation to the host-side pipeline; the circuit breaker and the
 * already-approved branches stay with the HTTP route, which owns agent
 * re-request semantics.
 */
export async function startRequestReviewPipeline(
  issueId: string,
  options: { note?: string; source?: RequestReviewSource; onReviewSpawned?: () => void } = {},
): Promise<StartRequestReviewOutcome> {
  const canonicalIssueId = issueId.toUpperCase();
  const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
  const projectPath = getProjectPath(undefined, issuePrefix);
  const issueLower = canonicalIssueId.toLowerCase();
  const branchName = `feature/${issueLower}`;

  const workspaceInfo = getWorkspaceInfoForIssue(issueId);
  const workspacePath = workspaceInfo.isRemote
    ? workspaceInfo.remotePath!
    : workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${issueLower}`);

  if (!workspaceInfo.exists) return { started: false, reason: 'no-workspace' };

  const dirtyWorkspaceError = await getDirtyWorkspaceErrorForReviewRequest(workspacePath, workspaceInfo);
  if (dirtyWorkspaceError) return { started: false, reason: 'dirty-workspace', error: dirtyWorkspaceError };

  if (requestReviewPipeline.isInFlight(canonicalIssueId)) {
    return { started: false, reason: 'already-running' };
  }

  if (!resolveProjectFromIssueSync(issueId)) return { started: false, reason: 'no-project' };

  transitionIssueToInReview(issueId, workspacePath).catch((err: unknown) => {
    console.warn(
      `[request-review] Could not transition ${issueId} to in_review: ${errorMessage(err)}`
    );
  });

  if (options.note) console.log(`[request-review] ${canonicalIssueId}: ${options.note}`);

  // The one door every review request passes through — the HTTP route, the
  // `pan review request` / `pan done` CLI behind it, and the PR webhook. This
  // is the moment Overdeck accepts the request, so this is where it is
  // journalled; nothing downstream re-states it.
  appendPipelineEntry(workspacePath, {
    type: 'review.requested',
    issueId: canonicalIssueId,
    source: options.source ?? 'api',
    ...(options.note ? { data: { note: options.note } } : {}),
  });

  const started = requestReviewPipeline.start(canonicalIssueId, {
    verify: () => Effect.runPromise(runVerificationForIssue(
      issueId,
      workspacePath,
      workspaceInfo,
      'request-review'
    )),
    onVerificationFailed: (outcome) => {
      // FR-8: the detail is in `verification-latest.json` and the check run.
      console.log(`[request-review] Verification failed for ${issueId} at ${outcome.failedCheck}`);
      completePendingOperation(issueId, `Verification failed at ${outcome.failedCheck} — fix and resubmit`);
    },
    onVerificationError: (outcome) => {
      console.error(`[request-review] Verification infrastructure error for ${issueId}: ${outcome.message}`);
      completePendingOperation(issueId, `Verification infrastructure error: ${outcome.message}`);
    },
    onVerificationDeferred: (outcome) => {
      console.log(`[request-review] Verification deferred for ${issueId}: ${outcome.reason}`);
      completePendingOperation(issueId, outcome.reason);
    },
    pushBranch: async () => {
      await pushReviewBranch(issueId, workspacePath, workspaceInfo, branchName);
      console.log(`[request-review] Pushed verified branch ${branchName} for ${issueId}`);
    },
    dispatchReview: async () => {
      const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
      const result = await Effect.runPromise(spawnReviewRoleForIssue({
        issueId,
        workspace: workspacePath,
        branch: branchName,
        force: true,
      }));

      if (result.success) {
        console.log(`[request-review] Review role spawned for ${issueId}`);
        options.onReviewSpawned?.();
        try {
          const { initEventStore } = await import('../../event-store.js');
          const store = await initEventStore();
          await store.appendAsync({
            type: 'pipeline.review-started',
            timestamp: new Date().toISOString(),
            payload: { issueId },
          });
        } catch { /* non-fatal */ }
        return;
      }

      if (result.gated) {
        console.log(`[request-review] Review deferred for ${issueId}: ${result.message}`);
        completePendingOperation(issueId, result.message);
        return;
      }

      const dispatchError = result.error || result.message || 'Failed to dispatch review';
      console.warn(`[request-review] Dispatch failed for ${issueId}: ${dispatchError}`);
      completePendingOperation(issueId, `Dispatch failed: ${dispatchError}`);
    },
    onError: (error) => {
      const detail = errorMessage(error) || String(error);
      console.error(`[request-review] Background pipeline failed for ${issueId}: ${detail}`);
      completePendingOperation(issueId, `Review pipeline error: ${detail}`);
    },
  });

  if (!started) return { started: false, reason: 'already-running' };
  const outcome: StartRequestReviewOutcome = { started: true };
  return workspaceInfo.isRemote && workspaceInfo.vmName
    ? { ...outcome, remoteVmName: workspaceInfo.vmName }
    : outcome;
}

// The webhook path reaches this door through the registry, never by importing
// a dashboard route from `src/lib/`.
registerRequestReviewStarter(startRequestReviewPipeline);

// ─── Route: POST /api/review/:issueId/trigger ─────────────────────────────
const postWorkspaceReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/trigger',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const requestedReviewMode = parseRequestedReviewMode(body);
    if (!requestedReviewMode.ok) {
      return jsonResponse({ error: requestedReviewMode.error }, { status: 400 });
    }
    const eventStore = yield* EventStoreService;

    const urlOpt = HttpServerRequest.toURL(request);
    const forceReview =
      (Option.isSome(urlOpt) && urlOpt.value.searchParams.get('force') === 'true') ||
      (body as { force?: unknown })?.force === true;

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const numericSuffix = issueLower.replace(/^[a-z]+-/, '');
    // Use numeric-suffix form (feature/1034) as canonical branch name
    const branchName = `feature/${numericSuffix}`;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    // Review runs against the local worktree only. Remote (fly.io) workspaces
    // exist for the work phase; the reap flow retires them and materializes
    // the local worktree before review (PAN-1676).
    if (workspaceInfo.isRemote) {
      return jsonResponse({
        error: `${issueId} is executing remotely on ${workspaceInfo.vmName ?? 'a fly machine'} — run 'pan admin remote reap --issue ${issueId}' after the agent finishes, then review.`,
      }, { status: 409 });
    }
    const workspacePath = workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${numericSuffix}`);

    const derived = yield* Effect.promise(() => getDerivedIssueState(issueId));

    // A reviewer asked for changes: the PR carries the feedback. Re-triggering
    // before addressing it just burns a review cycle.
    if (derived.state === 'changes-requested' && !forceReview) {
      return jsonResponse({
        success: false,
        alreadyReviewed: true,
        message: `Review requested changes on ${issueId}`,
        prUrl: derived.pr?.url,
        hint: 'Address the review feedback on the PR before requesting another review, or use force=true to override',
      });
    }

    if (derived.pr?.reviewState === 'approved' && !forceReview) {
      console.log(`[review] Skipping ${issueId}: PR already approved`);
      return jsonResponse({
        success: false,
        alreadyReviewed: true,
        message: `Review already passed for ${issueId}`,
        prUrl: derived.pr.url,
        hint: 'Issue already passed review — proceed to testing or merge',
      });
    }

    if (derived.state === 'merged') {
      console.log(`[review] Skipping ${issueId}: already merged`);
      return jsonResponse({
        success: false,
        alreadyMerged: true,
        message: `${issueId} is already merged`,
      });
    }

    if (!workspaceInfo.exists) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 400 });
    }

    // PAN-3847 (FR-16): refuse a re-review on a dirty tree or an unchanged,
    // already-approved HEAD — before any status reset or pending operation.
    const reReviewGuard = yield* Effect.promise(() =>
      reReviewGuardError(issueId, workspacePath, workspaceInfo, forceReview ? null : derived));
    if (reReviewGuard) {
      console.log(`[review] Rejecting re-review for ${issueId}: ${reReviewGuard.error}`);
      return jsonResponse({ success: false, error: reReviewGuard.error, hint: reReviewGuard.hint }, { status: 409 });
    }

    if (requestedReviewMode.mode !== undefined && !resolveProjectFromIssueSync(issueId)) {
      return jsonResponse({ error: `No project configured for ${issueId}` }, { status: 500 });
    }

    // PAN-3917: nothing to reset. There is no status row to move back to
    // `pending` — the PR is the record, and the pending-operation entry is
    // what the dashboard watches while the dispatch runs.
    setPendingOperation(issueId, 'review');

    // PAN-1765: short-circuit conflict-gated dispatches before responding so the
    // HTTP client gets a 409 with the deferral message instead of a false 200.
    // Use only the synchronous probe cache here: if a fresh cached result says
    // the branch is not mergeable, return 409 immediately. When the cache is
    // absent/stale, fall through to the background block below, which runs the
    // async probe inside spawnReviewRoleForIssue without holding the HTTP response.
    const cachedMergeability = getCachedConflictGateMergeability(issueId);
    if (cachedMergeability === 'conflicts' || cachedMergeability === 'unknown') {
      const message = cachedMergeability === 'conflicts'
        ? `Review deferred: merge conflict with main must be resolved before review dispatch`
        : `Review deferred: mergeability against main could not be verified; deferring review conservatively`;
      completePendingOperation(issueId, message);
      return jsonResponse({
        success: false,
        gated: true,
        message,
        pipeline: 'deferred',
      }, { status: 409 });
    }

    // Respond immediately
    // Run pipeline in background
    (async () => {
          try {
            transitionIssueToInReview(issueId, workspacePath).catch((err: unknown) => {
              console.warn(`[review] Could not transition ${issueId} to in_review: ${errorMessage(err)}`);
            });

            try {
              await pushFeatureBranches(issueId, workspacePath);
            } catch (pushErr: unknown) {
              console.log(`Feature branch push note: ${errorMessage(pushErr)}`);
            }

	            // Ensure review artifacts exist so review/test agents have stable URLs.
	            let reviewTargetBranch: string | undefined;
	            let artifactUrl: string | undefined;
	            try {
	              const { createReviewArtifactsForIssue } = await import('../../../../lib/review-artifacts.js');
	              const artifactResult = await createReviewArtifactsForIssue(issueId, workspacePath);
	              const primaryArtifact = artifactResult.mergeSet?.repos.find(repo => !!repo.artifactUrl);
	              reviewTargetBranch = artifactResult.mergeSet?.repos.find(repo => repo.repoMerge !== 'skipped')?.targetBranch;
	              if (primaryArtifact?.artifactUrl) {
	                artifactUrl = primaryArtifact.artifactUrl;
	                console.log(`[review] Review artifact ready for ${issueId}: ${primaryArtifact.artifactUrl}`);
	              } else {
	                console.warn(`[review] No review artifact URL available for ${issueId}`);
	              }
	            } catch (artifactErr: unknown) {
	              console.warn(`[review] Review artifact creation failed for ${issueId}: ${errorMessage(artifactErr)}`);
	            }

            try {
              (await Effect.runPromise(eventStore.append({
                type: 'pipeline.verification-started',
                timestamp: new Date().toISOString(),
                payload: { issueId },
              })));
            } catch { /* non-fatal */ }

            const verifyOutcome = await Effect.runPromise(runVerificationForIssue(
              issueId,
              workspacePath,
              workspaceInfo,
              'review'
            ));
            if (verifyOutcome.outcome === 'failed') {
              // FR-8: the failure is already in `verification-latest.json` and
              // its check run. The operator sees it through the pending
              // operation; the per-item tier escalation is deleted (FR-14).
              completePendingOperation(
                issueId,
                `Verification failed at ${verifyOutcome.failedCheck}`
              );
              try {
                (await Effect.runPromise(eventStore.append({
                  type: 'pipeline.verification-failed',
                  timestamp: new Date().toISOString(),
                  payload: { issueId, failedCheck: verifyOutcome.failedCheck },
                })));
              } catch { /* non-fatal */ }
              return;
            }
            if (verifyOutcome.outcome === 'error') {
              completePendingOperation(
                issueId,
                `Verification infrastructure error: ${verifyOutcome.message}`
              );
              try {
                (await Effect.runPromise(eventStore.append({
                  type: 'pipeline.verification-failed',
                  timestamp: new Date().toISOString(),
                  payload: { issueId, message: verifyOutcome.message },
                })));
              } catch { /* non-fatal */ }
              return;
            }
            if (verifyOutcome.outcome === 'deferred') {
              console.log(`[review] Verification deferred for ${issueId}: ${verifyOutcome.reason}`);
              completePendingOperation(issueId, verifyOutcome.reason);
              return;
            }

            // PAN-1048 C1/R3: review now runs as the role primitive via spawnRun
            // (loads roles/review.md → Agent tool fans out to code-review-* sub-agents).
            // The wrapper preserves dispatchParallelReview's orchestration concerns
            // (idempotency, feedback archive, status flip,
            // pipeline event) but the review itself is no longer a detached
            // `pan review run` coordinator process.
            const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
            const reviewResult = await Effect.runPromise(spawnReviewRoleForIssue({
              issueId,
              branch: branchName,
              workspace: workspacePath,
              ...(artifactUrl ? { prUrl: artifactUrl } : {}),
              force: forceReview,
            }));

            if (!reviewResult.success) {
              if (reviewResult.gated) {
                console.log(`[review] review dispatch deferred for ${issueId}: ${reviewResult.message}`);
                completePendingOperation(issueId, reviewResult.message);
                return;
              }

              console.warn(
                `[review] review dispatch failed: ${reviewResult.message}`
              );
              completePendingOperation(issueId, `Failed to start review: ${reviewResult.message}`);
              return;
            }

            console.log(`[review] Parallel review dispatched for ${issueId}`);
            completePendingOperation(issueId, null);
            try {
              (await Effect.runPromise(eventStore.append({
                type: 'pipeline.review-started',
                timestamp: new Date().toISOString(),
                payload: { issueId },
              })));
            } catch { /* non-fatal */ }
          } catch (error: unknown) {
            console.error(`[review] Error starting review:`, error);
            completePendingOperation(issueId, errorMessage(error));
          }
        })();

    return jsonResponse({
      success: true,
      message: `Review pipeline starting for ${issueId}`,
      pipeline: 'verification → review → test',
      note: 'Watch the status panel for progress.',
    });
  }))
);
// ─── Route: POST /api/review/:issueId/request ─────────────────────
const postWorkspaceRequestReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/request',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const parsedIssueId = parseIssueIdSync(issueId);
    if (!parsedIssueId) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const canonicalIssueId = issueId.toUpperCase();
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readJsonBody;
    const { message } = body as { message?: string };
    const rawSource = (body as { source?: unknown }).source;
    const requestSource: RequestReviewSource =
      rawSource === 'pan-done' || rawSource === 'pan-review-request' || rawSource === 'webhook'
        ? rawSource
        : 'api';
    const eventStore = yield* EventStoreService;

    const urlOpt = HttpServerRequest.toURL(request);
    const forceReview =
      (Option.isSome(urlOpt) && urlOpt.value.searchParams.get('force') === 'true') ||
      (body as { force?: unknown })?.force === true;
    const nudgeReview =
      (Option.isSome(urlOpt) && urlOpt.value.searchParams.get('nudge') === 'true') ||
      (body as { nudge?: unknown })?.nudge === true;

    const derived = yield* Effect.promise(() => getDerivedIssueState(canonicalIssueId));

    if (derived.state === 'merged') {
      console.log(`[request-review] Rejecting ${issueId}: already merged`);
      return jsonResponse({
        success: false,
        alreadyMerged: true,
        message: `${issueId} is already merged. Reopen the issue first.`,
      });
    }

    if (derived.pr?.reviewState === 'approved') {
      if (forceReview) {
        console.log(`[request-review] FORCE: full reset requested by operator for ${canonicalIssueId}`);
      } else if (nudgeReview) {
        // FR-8: "tests passed" is the PR's check state.
        if (derived.pr?.checks !== 'green') {
          return jsonResponse(
            {
              success: false,
              error: 'Cannot nudge — checks are not green',
              hint: 'Use ?force=true for a full re-review or wait for checks to complete',
            },
            { status: 400 },
          );
        }

        console.log(`[request-review] NUDGE: re-emitting test.passed for ${canonicalIssueId} without state reset`);
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'test.passed',
          timestamp: new Date().toISOString(),
          payload: { issueId: canonicalIssueId },
        })));
        return jsonResponse({
          success: true,
          nudged: true,
          message: `Re-emitted test.passed for ${canonicalIssueId}`,
        });
      }

      if (forceReview && shouldTreatAsRerun(derived)) {
        const issueLowerRerun = canonicalIssueId.toLowerCase();
        const issuePrefixRerun = extractPrefixSync(canonicalIssueId) ?? canonicalIssueId.split('-')[0];
        const projectPathRerun = getProjectPath(undefined, issuePrefixRerun);
        const wsInfoRerun = getWorkspaceInfoForIssue(canonicalIssueId);
        // Review runs against the local worktree only (PAN-1676) — see the
        // matching guard in /api/review/:issueId/trigger.
        if (wsInfoRerun.isRemote) {
          return jsonResponse({
            success: false,
            message: `${canonicalIssueId} is executing remotely on ${wsInfoRerun.vmName ?? 'a fly machine'} — run 'pan admin remote reap --issue ${canonicalIssueId}' after the agent finishes, then review.`,
          }, { status: 409 });
        }
        const workspacePathRerun = wsInfoRerun.localPath || join(projectPathRerun, 'workspaces', `feature-${issueLowerRerun}`);

        const dirtyError = yield* Effect.promise(() => getDirtyWorkspaceErrorForReviewRequest(workspacePathRerun, wsInfoRerun));
        if (dirtyError) {
          console.log(`[request-review] Rejecting ${issueId}: dirty workspace on rerun path`);
          return jsonResponse({ success: false, error: dirtyError }, { status: 400 });
        }

        // PAN-3847 (FR-16): a forced re-review is still refused when HEAD already
        // equals the approved anchor — nothing new to review.
        const rerunGuard = yield* Effect.promise(() =>
          reReviewGuardError(canonicalIssueId, workspacePathRerun, wsInfoRerun, null));
        if (rerunGuard) {
          console.log(`[request-review] Rejecting ${issueId}: ${rerunGuard.error} on rerun path`);
          return jsonResponse({ success: false, error: rerunGuard.error, hint: rerunGuard.hint }, { status: 409 });
        }

        console.log(`[request-review] ${issueId}: forcing full review/test rerun from an approved PR`);
        setPendingOperation(issueId, 'review');

        (async () => {
          try {
            // Resolve workspace info locally — outer scope vars (workspacePath, branchName)
            // are declared after the early return below and must not be relied on here.
            const branchNameRerun = `feature/${issueLowerRerun}`;

            transitionIssueToInReview(issueId, workspacePathRerun).catch((err: unknown) => {
              console.warn(`[request-review] Could not transition ${issueId} to in_review: ${errorMessage(err)}`);
            });

            try {
              await pushFeatureBranches(issueId, workspacePathRerun);
            } catch (pushErr: unknown) {
              console.log(`[request-review] Feature branch push note: ${errorMessage(pushErr)}`);
            }

            const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
            const result = await Effect.runPromise(spawnReviewRoleForIssue({
              issueId,
              workspace: workspacePathRerun,
              branch: branchNameRerun,
              ...(derived.pr?.url ? { prUrl: derived.pr.url } : {}),
              force: true,
            }));

            if (result.success) {
              // FR-7: the verdict lands as a PR review; nothing to record here.
              console.log(`[request-review] Review role spawned for ${issueId}`);
              completePendingOperation(issueId, null);
            } else if (result.gated) {
              console.log(`[request-review] Review deferred for ${issueId}: ${result.message}`);
              completePendingOperation(issueId, result.message);
            } else {
              const errorMsg = result.error || result.message || 'Failed to dispatch review';
              console.error(`[request-review] Dispatch failed for ${issueId}: ${errorMsg}`);
              completePendingOperation(issueId, errorMsg);
            }
          } catch (error: unknown) {
            console.error(`[request-review] Error:`, error);
            completePendingOperation(issueId, errorMessage(error) || 'Unknown error');
          }
        })();

        return jsonResponse({
          success: true,
          rerun: true,
          message: `Re-running review & test pipeline for ${issueId}`,
        });
      }

      if (derived.pr?.checks !== 'green') {
        console.log(
          `[request-review] ${issueId}: PR approved but checks ${derived.pr?.checks ?? 'unknown'} — dispatching test role`
        );

        try {
          const resolved = resolveProjectFromIssueSync(issueId);
          if (!resolved) {
            console.error(
              `[request-review] No project configured for ${issueId} — cannot spawn test role`
            );
          } else {
            const workspacePath = join(
              resolved.projectPath,
              'workspaces',
              `feature-${issueId.toLowerCase()}`
            );
            // PAN-1048 R1: spawn the test role via the role primitive. Reactive
            // Cloister normally drives this on lifecycle transitions; this path
            // is a manual re-dispatch for an already-approved PR.
            const { spawnRun } = yield* Effect.promise(() => import('../../../../lib/agents.js'));
            try {
              const testRun = yield* Effect.promise(() => spawnRun(issueId, 'test', {
                workspace: workspacePath,
                startedBy: 'dashboard:review-pipeline',
              }));
              console.log(
                `[request-review] Test role spawned for ${issueId} as ${testRun.id}`
              );
            } catch (testErr) {
              const msg = testErr instanceof Error ? testErr.message : String(testErr);
              console.error(
                `[request-review] Test role spawn failed for ${issueId}: ${msg}`
              );
              completePendingOperation(issueId, `Test dispatch failed: ${msg}`);
            }
          }
        } catch (err: unknown) {
          console.warn(
            `[request-review] Failed to queue test role for ${issueId}: ${errorMessage(err)}`
          );
        }
        return jsonResponse({
          success: true,
          requeued: true,
          message: `Tests re-queued for ${issueId} (PR already approved)`,
        });
      }
      console.log(
        `[request-review] ${issueId}: review already passed — returning success no-op`
      );
      return jsonResponse({
        success: true,
        alreadyPassed: true,
        message: `Review already passed for ${issueId}`,
      });
    }

    const currentCount = autoRequeueCounts.get(canonicalIssueId) ?? 0;

    if (currentCount >= MAX_AUTO_REQUEUE) {
      console.log(
        `[request-review] Circuit breaker: ${issueId} exceeded max auto-requeues (${currentCount}/${MAX_AUTO_REQUEUE})`
      );
      return jsonResponse(
        {
          success: false,
          error: 'Circuit breaker triggered',
          message: `Maximum automatic re-review requests (${MAX_AUTO_REQUEUE}) exceeded. Human intervention required.`,
          autoRequeueCount: currentCount,
          hint: 'A human must click the Review button to continue.',
        },
        { status: 429 }
      );
    }

    const newCount = currentCount + 1;
    const requestNote = message
      ? `Agent re-review request (${newCount}/${MAX_AUTO_REQUEUE}): ${message}`
      : `Agent re-review request (${newCount}/${MAX_AUTO_REQUEUE})`;

    const outcome = yield* Effect.promise(() => startRequestReviewPipeline(issueId, {
      note: requestNote,
      source: requestSource,
      onReviewSpawned: () => autoRequeueCounts.set(canonicalIssueId, newCount),
    }));

    if (!outcome.started) {
      if (outcome.reason === 'no-workspace') {
        return jsonResponse({ success: false, error: 'Workspace does not exist' }, { status: 400 });
      }
      if (outcome.reason === 'dirty-workspace') {
        return jsonResponse({ success: false, error: outcome.error }, { status: 400 });
      }
      if (outcome.reason === 'no-project') {
        return jsonResponse(
          {
            success: false,
            error: `No project configured for ${issueId}. Add it to projects.yaml.`,
            autoRequeueCount: currentCount,
          },
          { status: 500 }
        );
      }
      return jsonResponse({
        success: true,
        queued: true,
        alreadyRunning: true,
        message: `Verification already running for ${canonicalIssueId}; review will start automatically when it passes`,
      }, { status: 202 });
    }

    console.log(
      `[request-review] Verification started for ${issueId}; review will dispatch after the verified branch is pushed${outcome.remoteVmName ? ` (remote: ${outcome.remoteVmName})` : ''}`
    );
    return jsonResponse({
      success: true,
      queued: true,
      message: `Verification started for ${canonicalIssueId}; review will start automatically when it passes`,
      autoRequeueCount: currentCount,
      remainingRequeues: MAX_AUTO_REQUEUE - currentCount,
    }, { status: 202 });
  }))
);

// ─── Route: GET /api/workspaces/:issueId/release ────────────────────────────

const getReleaseSetRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/release',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const rawIssueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(rawIssueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issueId = resolveIssueIdSync(rawIssueId);

    const releaseSet = getReleaseSetSync(issueId);
    if (!releaseSet) {
      return jsonResponse({ error: 'Release set not found' }, { status: 404 });
    }

    return jsonResponse(releaseSet);
  }))
);

export const reviewPipelineRouteLayer = Layer.mergeAll(
  postWorkspaceReviewRoute,
  postWorkspaceRequestReviewRoute,
  getReleaseSetRoute,
);

export default reviewPipelineRouteLayer;
