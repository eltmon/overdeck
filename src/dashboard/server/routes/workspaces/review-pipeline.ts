/**
 * Review-pipeline route module — extracted from routes/workspaces.ts (B / wave 2, seam 3a).
 *
 * Review dispatch endpoints (start / re-run the review+test pipeline):
 *   POST /api/review/:issueId/trigger
 *   POST /api/review/:issueId/request
 *
 * The cancel/control routes (reset, purge, abort, pending, unstick,
 * deacon-ignore, auto-merge) live in review-control.ts. Shared singletons
 * (review-status wrapper, pending-ops cluster, project path, readJsonBody,
 * workspace info, flyExecCmd) stay owned by ../workspaces.js.
 */

import { exec } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { EventStoreService } from '../../services/domain-services.js';
import { getReviewStatusSync, type ReviewStatus } from '../../../../lib/review-status.js';
import { getCachedConflictGateMergeability } from '../../../../lib/cloister/conflict-gate.js';
import { restoreTrackedBeadsExport } from '../../../../lib/beads-restore.js';
import { transitionIssueToInReview, spawnRun } from '../../../../lib/agents.js';
import { runVerificationForIssue } from '../../../../lib/cloister/verification-runner.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  readJsonBody,
  getWorkspaceInfoForIssue,
  setReviewStatus,
  setPendingOperation,
  completePendingOperation,
  clearPendingOperation,
  flyExecCmd,
  type WorkspaceInfo,
} from '../workspaces.js';

const execAsync = promisify(exec);
const MAX_AUTO_REQUEUE = 25;

/** Safe `.message` read for caught values of unknown shape. */
const errorMessage = (e: unknown): string | undefined => e instanceof Error ? e.message : undefined;

function shouldTreatAsRerun(status: Pick<ReviewStatus, 'readyForMerge' | 'reviewStatus' | 'testStatus' | 'mergeStatus'> | null | undefined): boolean {
  if (!status) return false;
  return status.readyForMerge === true
    || status.reviewStatus === 'passed'
    || status.testStatus === 'passed'
    || status.mergeStatus === 'failed';
}
async function getDirtyWorkspaceErrorForReviewRequest(
  workspacePath: string,
  workspaceInfo: WorkspaceInfo,
): Promise<string | null> {
  try {
    if (!workspaceInfo.isRemote) {
      await Effect.runPromise(restoreTrackedBeadsExport(workspacePath));
    }

    const statusCmd = 'git status --porcelain -uno';
    const status = workspaceInfo.isRemote && workspaceInfo.vmName
      ? (await execAsync(
          flyExecCmd(workspaceInfo.vmName, `cd ${workspacePath} && ${statusCmd}`),
          { encoding: 'utf-8', timeout: 30000 },
        )).stdout
      : (await execAsync(statusCmd, { cwd: workspacePath, encoding: 'utf-8' })).stdout;

    if (!status.trim()) {
      return null;
    }

    return `Workspace has uncommitted changes. Commit the changes, explicitly discard them, or surface them to the operator before requesting review:\ncd ${workspacePath}\ngit status`;
  } catch {
    return null;
  }
}
// ─── Route: POST /api/review/:issueId/trigger ─────────────────────────────

const postWorkspaceReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/trigger',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* readJsonBody;
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

    const existingStatus = getReviewStatusSync(issueId);

    if (existingStatus?.reviewNotes && ['blocked', 'failed'].includes(existingStatus.reviewStatus || '')) {
      const infraFailurePatterns = [
        'Failed to send task',
        "can't find pane",
        'Command failed: tmux',
        'Operation timed out',
        'specialist.*not running',
        'specialist.*busy',
        'legacy specialist wake',
      ];
      const isInfraFailure = infraFailurePatterns.some(pattern =>
        new RegExp(pattern, 'i').test(existingStatus.reviewNotes || '')
      );

      if (!isInfraFailure && !forceReview) {
        return jsonResponse({
          success: false,
          alreadyReviewed: true,
          message: `Review already completed with status: ${existingStatus.reviewStatus}`,
          reviewNotes: existingStatus.reviewNotes,
          hint: 'Address the review feedback before requesting another review, or use force=true to override',
        });
      }

      console.log(
        `[review] Re-triggering review for ${issueId} (${isInfraFailure ? 'infrastructure failure' : 'forced'})`
      );
    }

    if (existingStatus?.reviewStatus === 'passed' && !forceReview) {
      console.log(`[review] Skipping ${issueId}: already passed review`);
      return jsonResponse({
        success: false,
        alreadyReviewed: true,
        message: `Review already passed for ${issueId}`,
        hint: 'Issue already passed review — proceed to testing or merge',
      });
    }

    if (existingStatus?.mergeStatus === 'merged') {
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

    // Reset review status — keep 'pending' until dispatch succeeds (PAN-511 atomicity fix).
    // reviewStatus is set to 'reviewing' only after the specialist is successfully dispatched
    // or queued, not before. This prevents stuck 'reviewing' state if Cloister crashes mid-dispatch.
    setPendingOperation(issueId, 'review');
    const reviewReset: Record<string, unknown> = {
      reviewStatus: 'pending',
      testStatus: 'pending',
      autoRequeueCount: 0,
      verificationCycleCount: 0,
      verificationStatus: 'pending',
      verificationNotes: undefined,
    };
    if (forceReview) {
      reviewReset.readyForMerge = false;
      reviewReset.mergeStatus = 'pending';
      reviewReset.reviewNotes = undefined;
      reviewReset.testNotes = undefined;
    }
    setReviewStatus(issueId, reviewReset);

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
      setReviewStatus(issueId, { reviewStatus: 'pending', reviewNotes: message });
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
              await execAsync(`git push origin ${branchName}`, {
                cwd: workspacePath,
                encoding: 'utf-8',
              });
            } catch (pushErr: unknown) {
              console.log(`Feature branch push note: ${errorMessage(pushErr)}`);
            }

	            // Ensure review artifacts exist so review/test agents have stable URLs.
	            let reviewTargetBranch: string | undefined;
	            try {
	              const { createReviewArtifactsForIssue } = await import('../../../../lib/review-artifacts.js');
	              const artifactResult = await Effect.runPromise(createReviewArtifactsForIssue(issueId, workspacePath));
	              const primaryArtifact = artifactResult.mergeSet?.repos.find(repo => !!repo.artifactUrl);
	              reviewTargetBranch = artifactResult.mergeSet?.repos.find(repo => repo.mergeStatus !== 'skipped')?.targetBranch;
	              if (primaryArtifact?.artifactUrl) {
	                setReviewStatus(issueId, { prUrl: primaryArtifact.artifactUrl });
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
              completePendingOperation(
                issueId,
                `Verification failed at ${verifyOutcome.failedCheck}`
              );
              setReviewStatus(issueId, {
                reviewStatus: 'failed',
                reviewNotes: `Verification failed at ${verifyOutcome.failedCheck}`,
              });
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
              setReviewStatus(issueId, {
                reviewStatus: 'failed',
                reviewNotes: `Verification error: ${verifyOutcome.message}`,
              });
              try {
                (await Effect.runPromise(eventStore.append({
                  type: 'pipeline.verification-failed',
                  timestamp: new Date().toISOString(),
                  payload: { issueId, message: verifyOutcome.message },
                })));
              } catch { /* non-fatal */ }
              return;
            }

            // PAN-1048 C1/R3: review now runs as the role primitive via spawnRun
            // (loads roles/review.md → Agent tool fans out to code-review-* sub-agents).
            // The wrapper preserves dispatchParallelReview's orchestration concerns
            // (idempotency, feedback archive, status flip,
            // pipeline event) but the review itself is no longer a detached
            // `pan review run` coordinator process.
            const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
            const prUrl = getReviewStatusSync(issueId)?.prUrl;
            const reviewResult = await Effect.runPromise(spawnReviewRoleForIssue({
              issueId,
              branch: branchName,
              workspace: workspacePath,
              prUrl,
              force: forceReview,
            }));

            if (!reviewResult.success) {
              if (reviewResult.gated) {
                console.log(`[review] review dispatch deferred for ${issueId}: ${reviewResult.message}`);
                completePendingOperation(issueId, reviewResult.message);
                setReviewStatus(issueId, {
                  reviewStatus: 'pending',
                  reviewNotes: reviewResult.message,
                });
                return;
              }

              console.warn(
                `[review] review dispatch failed: ${reviewResult.message}`
              );
              completePendingOperation(issueId, `Failed to start review: ${reviewResult.message}`);
              setReviewStatus(issueId, {
                reviewStatus: 'pending',
                reviewNotes: reviewResult.message,
              });
              return;
            }

            console.log(`[review] Parallel review dispatched for ${issueId}`);
            // PAN-511: set 'reviewing' only after dispatch succeeds
            setReviewStatus(issueId, { reviewStatus: 'reviewing' });
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
            setReviewStatus(issueId, { reviewStatus: 'pending', reviewNotes: errorMessage(error) });
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
    const eventStore = yield* EventStoreService;

    const urlOpt = HttpServerRequest.toURL(request);
    const forceReview =
      (Option.isSome(urlOpt) && urlOpt.value.searchParams.get('force') === 'true') ||
      (body as { force?: unknown })?.force === true;
    const nudgeReview =
      (Option.isSome(urlOpt) && urlOpt.value.searchParams.get('nudge') === 'true') ||
      (body as { nudge?: unknown })?.nudge === true;

    const existingStatus = getReviewStatusSync(issueId);

    if (existingStatus?.mergeStatus === 'merged') {
      console.log(`[request-review] Rejecting ${issueId}: already merged`);
      return jsonResponse({
        success: false,
        alreadyMerged: true,
        message: `${issueId} is already merged. Use Reopen or Reset Reviews first.`,
      });
    }

    if (existingStatus?.reviewStatus === 'passed') {
      if (forceReview) {
        console.log(`[request-review] FORCE: full reset requested by operator for ${canonicalIssueId}`);
      } else if (nudgeReview) {
        if (existingStatus.testStatus !== 'passed') {
          return jsonResponse(
            {
              success: false,
              error: 'Cannot nudge — tests have not passed',
              hint: 'Use ?force=true for a full re-review or wait for tests to complete',
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

      if (forceReview && shouldTreatAsRerun(existingStatus)) {
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

        if (!wsInfoRerun.isRemote) {
          yield* restoreTrackedBeadsExport(workspacePathRerun);
        }
        const dirtyError = yield* Effect.promise(() => getDirtyWorkspaceErrorForReviewRequest(workspacePathRerun, wsInfoRerun));
        if (dirtyError) {
          console.log(`[request-review] Rejecting ${issueId}: dirty workspace on rerun path`);
          return jsonResponse({ success: false, error: dirtyError }, { status: 400 });
        }

        console.log(`[request-review] ${issueId}: forcing full review/test rerun from passed state`);
        setPendingOperation(issueId, 'review');
        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          testStatus: 'pending',
          mergeStatus: 'pending',
          readyForMerge: false,
          autoRequeueCount: 0,
          verificationCycleCount: 0,
          verificationStatus: 'pending',
          verificationNotes: undefined,
          reviewNotes: undefined,
          testNotes: undefined,
          mergeNotes: undefined,
        });

        (async () => {
          try {
            // Resolve workspace info locally — outer scope vars (workspacePath, branchName)
            // are declared after the early return below and must not be relied on here.
            const branchNameRerun = `feature/${issueLowerRerun}`;

            transitionIssueToInReview(issueId, workspacePathRerun).catch((err: unknown) => {
              console.warn(`[request-review] Could not transition ${issueId} to in_review: ${errorMessage(err)}`);
            });

            try {
              await execAsync(`git push origin ${branchNameRerun}`, {
                cwd: workspacePathRerun,
                encoding: 'utf-8',
              });
            } catch (pushErr: unknown) {
              console.log(`[request-review] Feature branch push note: ${errorMessage(pushErr)}`);
            }

            const prUrl = getReviewStatusSync(issueId)?.prUrl;
            const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
            const result = await Effect.runPromise(spawnReviewRoleForIssue({
              issueId,
              workspace: workspacePathRerun,
              branch: branchNameRerun,
              prUrl,
              force: true,
            }));

            if (result.success) {
              // reviewStatus transitions ('reviewing' → passed/blocked/failed) are
              // managed by the review role itself via /api/review/:id/status.
              console.log(`[request-review] Review role spawned for ${issueId}`);
            } else if (result.gated) {
              console.log(`[request-review] Review deferred for ${issueId}: ${result.message}`);
              setReviewStatus(issueId, { reviewStatus: 'pending', reviewNotes: result.message });
            } else {
              const errorMsg = result.error || result.message || 'Failed to dispatch review';
              console.error(`[request-review] Dispatch failed for ${issueId}: ${errorMsg}`);
              setReviewStatus(issueId, { reviewStatus: 'pending', reviewNotes: errorMsg });
            }
          } catch (error: unknown) {
            console.error(`[request-review] Error:`, error);
            setReviewStatus(issueId, {
              reviewStatus: 'pending',
              reviewNotes: errorMessage(error) || 'Unknown error',
            });
          }
        })();

        return jsonResponse({
          success: true,
          rerun: true,
          message: `Re-running review & test pipeline for ${issueId}`,
        });
      }

      if (existingStatus.testStatus === 'failed' || existingStatus.testStatus === 'pending' || existingStatus.testStatus === 'dispatch_failed') {
        console.log(
          `[request-review] ${issueId}: review passed but tests ${existingStatus.testStatus} — dispatching test role`
        );
        setReviewStatus(issueId, { testStatus: 'pending' });

        try {
          const resolved = resolveProjectFromIssueSync(issueId);
          if (!resolved) {
            console.error(
              `[request-review] No project configured for ${issueId} — cannot spawn test role`
            );
            setReviewStatus(issueId, {
              testStatus: 'dispatch_failed',
              testNotes: 'No project configured',
            });
          } else {
            const workspacePath = join(
              resolved.projectPath,
              'workspaces',
              `feature-${issueId.toLowerCase()}`
            );
            setReviewStatus(issueId, { testStatus: 'testing' });
            // PAN-1048 R1: spawn the test role via the role primitive instead
            // of the legacy spawnEphemeralSpecialist machinery. Reactive
            // Cloister normally drives this on lifecycle transitions; this
            // path is a manual re-dispatch for already-approved reviews.
            const { spawnRun } = yield* Effect.promise(() => import('../../../../lib/agents.js'));
            try {
              const testRun = yield* Effect.promise(() => spawnRun(issueId, 'test', {
                workspace: workspacePath,
              }));
              console.log(
                `[request-review] Test role spawned for ${issueId} as ${testRun.id}`
              );
            } catch (testErr) {
              const msg = testErr instanceof Error ? testErr.message : String(testErr);
              console.error(
                `[request-review] Test role spawn failed for ${issueId}: ${msg}`
              );
              setReviewStatus(issueId, {
                testStatus: 'dispatch_failed',
                testNotes: `Test dispatch failed: ${msg}`,
              });
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
          message: `Tests re-queued for ${issueId} (review already passed)`,
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

    const currentCount = existingStatus?.autoRequeueCount || 0;

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

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const branchName = `feature/${issueLower}`;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const workspacePath = workspaceInfo.isRemote
      ? workspaceInfo.remotePath!
      : workspaceInfo.localPath || join(projectPath, 'workspaces', `feature-${issueLower}`);

    if (!workspaceInfo.exists) {
      return jsonResponse(
        { success: false, error: 'Workspace does not exist' },
        { status: 400 }
      );
    }

    if (!workspaceInfo.isRemote) {
      yield* restoreTrackedBeadsExport(workspacePath);
    }

    const dirtyWorkspaceError = yield* Effect.promise(() => getDirtyWorkspaceErrorForReviewRequest(workspacePath, workspaceInfo));
    if (dirtyWorkspaceError) {
      return jsonResponse(
        { success: false, error: dirtyWorkspaceError },
        { status: 400 }
      );
    }

    transitionIssueToInReview(issueId, workspacePath).catch((err: unknown) => {
      console.warn(
        `[request-review] Could not transition ${issueId} to in_review: ${errorMessage(err)}`
      );
    });

    const newCount = currentCount + 1;
    const reviewNotes = message
      ? `Agent re-review request (${newCount}/${MAX_AUTO_REQUEUE}): ${message}`
      : undefined;

    const reqVerifyOutcome = yield* runVerificationForIssue(
      issueId,
      workspacePath,
      workspaceInfo,
      'request-review'
    );
    if (reqVerifyOutcome.outcome === 'failed') {
      return jsonResponse({
        success: false,
        verificationFailed: true,
        failedCheck: reqVerifyOutcome.failedCheck,
        message: `Verification failed at ${reqVerifyOutcome.failedCheck} — fix and resubmit`,
        cycleCount: reqVerifyOutcome.cycleCount,
        maxCycles: reqVerifyOutcome.maxCycles,
      });
    }
    if (reqVerifyOutcome.outcome === 'error') {
      return jsonResponse(
        {
          success: false,
          error: `Verification infrastructure error: ${reqVerifyOutcome.message}`,
          autoRequeueCount: currentCount,
        },
        { status: 500 }
      );
    }

    // PAN-511: set metadata fields but keep reviewStatus='pending' until dispatch succeeds.
    // reviewStatus is set to 'reviewing' only after specialist is dispatched or queued.
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      testStatus: 'pending',
      autoRequeueCount: newCount,
      reviewNotes,
    });

    console.log(
      `[request-review] Agent requested re-review for ${issueId} (${newCount}/${MAX_AUTO_REQUEUE})${workspaceInfo.isRemote ? ` (remote: ${workspaceInfo.vmName})` : ''}`
    );

    try {
      const resolved = resolveProjectFromIssueSync(issueId);

      if (!resolved) {
        return jsonResponse(
          {
            success: false,
            error: `No project configured for ${issueId}. Add it to projects.yaml.`,
            autoRequeueCount: newCount,
          },
          { status: 500 }
        );
      }

      const result = yield* Effect.promise(async () => {
        const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
        return (await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace: workspacePath,
          branch: branchName,
          force: true,
        })));
      });

      if (result.success) {
        console.log(`[request-review] Review role spawned for ${issueId}`);
        // PAN-511: set 'reviewing' only after spawn succeeds. spawnReviewRoleForIssue
        // already flips reviewStatus internally, but we keep this redundant write
        // to preserve the original ordering invariant for downstream readers.
        // Increment autoRequeueCount only on a real dispatch.
        setReviewStatus(issueId, { reviewStatus: 'reviewing', autoRequeueCount: newCount });
        yield* Effect.promise(() => Effect.runPromise(eventStore.append({
          type: 'pipeline.review-started',
          timestamp: new Date().toISOString(),
          payload: { issueId },
        })));
        return jsonResponse({
          success: true,
          queued: false,
          message: `Review started (${newCount}/${MAX_AUTO_REQUEUE} auto-requeues used)`,
          autoRequeueCount: newCount,
          remainingRequeues: MAX_AUTO_REQUEUE - newCount,
        });
      } else if (result.gated) {
        console.log(`[request-review] Review deferred for ${issueId}: ${result.message}`);
        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          reviewNotes: result.message,
          autoRequeueCount: currentCount,
        });
        return jsonResponse(
          {
            success: false,
            gated: true,
            message: result.message,
            autoRequeueCount: currentCount,
            remainingRequeues: MAX_AUTO_REQUEUE - currentCount,
          },
          { status: 409 }
        );
      } else {
        console.warn(
          `[request-review] Dispatch failed for ${issueId}: ${result.error}`
        );
        setReviewStatus(issueId, {
          reviewStatus: 'pending',
          reviewNotes: `Dispatch failed: ${result.error || result.message}`,
          autoRequeueCount: currentCount,
        });
        return jsonResponse(
          {
            success: false,
            error: result.error || 'Failed to dispatch review',
            autoRequeueCount: currentCount,
            remainingRequeues: MAX_AUTO_REQUEUE - currentCount,
          },
          { status: 500 }
        );
      }
    } catch (error: unknown) {
      console.error(`[request-review] Error:`, error);
      setReviewStatus(issueId, {
        reviewStatus: 'pending',
        reviewNotes: `Dispatch error: ${errorMessage(error)}`,
      });
      return jsonResponse(
        { success: false, error: errorMessage(error), autoRequeueCount: newCount },
        { status: 500 }
      );
    }
  }))
);

export const reviewPipelineRouteLayer = Layer.mergeAll(
  postWorkspaceReviewRoute,
  postWorkspaceRequestReviewRoute,
);

export default reviewPipelineRouteLayer;
