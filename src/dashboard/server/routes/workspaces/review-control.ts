/**
 * Review-control route module — extracted from routes/workspaces.ts (B / wave 2, seam 3b).
 *
 * Operator control endpoints over the review/worker lifecycle:
 *   POST   /api/review/:issueId/reset
 *   POST   /api/review/:issueId/purge
 *   POST   /api/review/:issueId/abort
 *   DELETE /api/review/:issueId/pending
 *   POST   /api/workspaces/:issueId/unstick
 *   POST   /api/workspaces/:issueId/deacon-ignore
 *   POST   /api/workspaces/:issueId/auto-merge
 *
 * The dispatch routes (trigger, request) live in review-pipeline.ts. Shared
 * singletons (review-status wrapper, project path, readJsonBody, workspace info)
 * stay owned by ../workspaces.js.
 */

import { exec } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import { findWorkspacePath } from '../../../../lib/lifecycle/archive-planning.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import {
  getReviewStatusSync,
  setReviewStatusSync as setReviewStatusBase,
  markWorkspaceStuck,
  setDeaconIgnored,
  setAutoMerge,
} from '../../../../lib/review-status.js';
import { getAgentRuntimeStateSync } from '../../../../lib/agents.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  readJsonBody,
  getWorkspaceInfoForIssue,
  setReviewStatus,
  requireTrustedMutationOrigin,
} from '../workspaces.js';

const execAsync = promisify(exec);

export type ResetReviewResult =
  | { httpStatus: 400; body: { success: false; error: string } }
  | {
      httpStatus: 200;
      body: {
        success: true;
        /** Work-agent runtime state observed before the reset — informational, logged for debugging. */
        preservedResolution?: { agentId: string; resolution?: string; resolutionCount?: number };
      };
    };

/**
 * Core logic for POST /api/review/:issueId/reset (synchronous, testable).
 *
 * Resets the specialist pipeline state (review / test / merge / verification) for
 * a workspace. Writes ONE setReviewStatus() call, reads the work-agent's runtime
 * state purely for logging, and returns a structured result that the route
 * handler maps to an HTTP response.
 *
 * CRITICAL — resolution preservation:
 * This function deliberately does NOT mutate the work-agent's runtime state
 * (resolution / resolutionCount / activity). `resolution` tracks the WORK
 * agent's own lifecycle (working/done/unclear/stuck/needs_input) and is written
 * exclusively by `work-agent-stop-hook` based on the agent's tail. The pipeline
 * reset is about specialist state — wiping resolution here previously erased
 * legitimate unclear/stuck counts when `pan done`'s self-heal path triggered a
 * reset, which prevented the deacon from noticing genuinely confused agents.
 * (Root cause of PAN-805 never escalating to stuck.)
 *
 * Regression test: tests/unit/dashboard/server/routes/reset-review-route.test.ts
 *
 * Exported so a unit test can assert the sync mutation set is exactly
 * {reset review status} — nothing else.
 */
export function processResetReviewPipeline(
  issueId: string,
  workspaceExists: boolean,
): ResetReviewResult {
  if (!workspaceExists) {
    return {
      httpStatus: 400,
      body: { success: false, error: 'Workspace does not exist' },
    };
  }

  const agentId = `agent-${issueId.toLowerCase()}`;
  const priorRuntime = getAgentRuntimeStateSync(agentId);

  console.log(
    `[reset-review] Human-initiated pipeline reset for ${issueId} ` +
      `(work-agent ${agentId} resolution=${priorRuntime?.resolution ?? 'none'}/` +
      `${priorRuntime?.resolutionCount ?? 0} — preserved, not reset)`
  );

  setReviewStatus(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    reviewNotes: undefined,
    testNotes: undefined,
    mergeNotes: undefined,
    readyForMerge: false,
    autoRequeueCount: 0,
    verificationStatus: 'pending',
    verificationNotes: undefined,
    verificationCycleCount: 0,
    // A human-initiated reset is an explicit circuit-breaker override: clear
    // the stuck marker and the review/test retry counters too. Without this,
    // a workspace stuck on review_infrastructure_failure (or with exhausted
    // retry budgets) is reset to `pending` but immediately re-skipped by the
    // deacon's stuck guard / retry-budget checks — the "override" is a no-op.
    stuck: false,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
    reviewRetryCount: 0,
    testRetryCount: 0,
    mergeRetryCount: 0,
    recoveryStartedAt: undefined,
  });

  return {
    httpStatus: 200,
    body: {
      success: true,
      preservedResolution: priorRuntime
        ? {
            agentId,
            resolution: priorRuntime.resolution,
            resolutionCount: priorRuntime.resolutionCount,
          }
        : undefined,
    },
  };
}

/**
 * Resolve whether a workspace exists for the reset endpoint, including
 * strike workspaces (feature-<id>-strike) that getWorkspaceInfoForIssue does
 * not yet know about. PAN-2270 regression test hook.
 */
export function resolveResetWorkspace(
  issueId: string,
  workspaceInfo: { exists: boolean; localPath?: string },
  resolved: { projectPath: string } | null,
): { exists: boolean; localPath: string | null } {
  const issueLower = issueId.toLowerCase();
  const workspacePath = resolved ? findWorkspacePath(resolved.projectPath, issueLower) : null;
  return {
    exists: workspaceInfo.exists || workspacePath !== null,
    localPath: workspaceInfo.localPath || workspacePath,
  };
}

/**
 * Build the workspace/branch pair for a review re-dispatch, handling
 * strike workspaces (feature-<id>-strike -> strike/<id>) and preserving the
 * existing feature/<numeric> convention for non-strike workspaces.
 * PAN-2270 regression test hook.
 */
export function buildReviewRedispatchArgs(
  issueId: string,
  resetWorkspace: { localPath: string | null },
  workspaceInfo: { localPath?: string },
  resolved: { projectPath: string } | null,
): { workspace: string; branch: string } | null {
  if (!resolved) return null;
  const issueLower = issueId.toLowerCase();
  const numericSuffix = issueLower.replace(/^[a-z]+-/, '');
  const wsPath =
    resetWorkspace.localPath ||
    workspaceInfo.localPath ||
    findWorkspacePath(resolved.projectPath, issueLower) ||
    join(resolved.projectPath, 'workspaces', `feature-${numericSuffix}`);
  const branchName = wsPath.endsWith('-strike')
    ? `strike/${issueLower}`
    : `feature/${numericSuffix}`;
  return { workspace: wsPath, branch: branchName };
}
export type UnstickResult =
  | { httpStatus: 404; body: { success: false; error: string } }
  | { httpStatus: 400; body: { success: false; error: string } }
  | { httpStatus: 409; body: { success: false; error: string } }
  | { httpStatus: 200; body: { success: true; issueId: string; previousReason?: string } };

export type UnstickGitRepairState =
  | { safe: true }
  | { safe: false; advice: string };

/**
 * Core logic for POST /api/workspaces/:issueId/unstick.
 *
 * Validates preconditions (workspace exists, workspace is stuck, git state is
 * repaired), clears the persistent stuck marker, and invalidates stale
 * review/test results by resetting the lifecycle to pending.
 *
 * The recovery path changes the project's main-branch state by committing,
 * pushing, fast-forwarding, or otherwise reconciling it. Keeping
 * reviewStatus=passed after that would let the UI present a stale approval.
 * One atomic setReviewStatus() call clears stuck state and resets the
 * lifecycle in a single DB write and a single notifyPipeline event.
 *
 * gitRepairState must be pre-verified by the caller (async git check). An
 * unsafe result returns 409 with recovery instructions before any DB mutation.
 *
 * Exported for unit testing — the route handler calls this and maps the result
 * directly to an HTTP response.
 */
export function processUnstickRequest(
  issueId: string,
  workspaceExists: boolean,
  currentStatus: ReturnType<typeof getReviewStatusSync>,
  gitRepairState: UnstickGitRepairState,
): UnstickResult {
  if (!workspaceExists) {
    return { httpStatus: 404, body: { success: false, error: 'Workspace does not exist' } };
  }
  if (!currentStatus?.stuck) {
    return { httpStatus: 400, body: { success: false, error: `Workspace ${issueId} is not stuck` } };
  }
  // Enforce that the operator has actually repaired the git state before we
  // clear the stuck flag. If project main still has local-only commits, remote
  // commits, or uncommitted changes, Deacon would immediately re-enter the same
  // broken approve/merge path.
  if (!gitRepairState.safe) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        error: `Workspace git state is not yet repaired. ${gitRepairState.advice} Then retry Unstick.`,
      },
    };
  }
  // Single atomic write: clear stuck fields and reset lifecycle to pending.
  setReviewStatusBase(issueId, {
    reviewStatus: 'pending',
    testStatus: 'pending',
    mergeStatus: 'pending',
    readyForMerge: false,
    stuck: undefined,
    stuckReason: undefined,
    stuckAt: undefined,
    stuckDetails: undefined,
    reviewedAtCommit: undefined,
    // PAN-794: unstick opens a fresh recovery cycle — arm the breaker budget
    // again so legitimate transient failures don't inherit prior cycle counts.
    reviewRetryCount: 0,
    recoveryStartedAt: undefined,
  });
  console.log(`[unstick] Cleared stuck flag and reset lifecycle for ${issueId} (was: ${currentStatus.stuckReason ?? 'unknown'})`);
  return { httpStatus: 200, body: { success: true, issueId, previousReason: currentStatus.stuckReason } };
}

function buildUnstickRepairAdvice(aheadCount: number, behindCount: number, dirty: boolean): string | null {
  const steps: string[] = [];
  if (dirty) {
    steps.push('commit the project repo changes that should be preserved, or explicitly discard only changes known to be disposable');
  }
  if (aheadCount > 0 && behindCount > 0) {
    steps.push(`reconcile local main with origin/main while preserving the ${aheadCount} local commit(s), then push the reconciled main`);
  } else if (aheadCount > 0) {
    steps.push(`push the ${aheadCount} local main commit(s) to origin/main`);
  } else if (behindCount > 0) {
    steps.push(`fast-forward local main from origin/main (${behindCount} commit(s) behind)`);
  }
  return steps.length > 0 ? `In the project repo, ${steps.join('; ')}.` : null;
}

/**
 * Check whether the project repo's local main branch matches origin/main and
 * has no uncommitted changes. Unsafe states return recoverable instructions:
 * push local-only commits, commit dirty work, fast-forward behind branches, or
 * reconcile a true divergence. Never prescribe destructive reset.
 *
 * Returns safe for any git error so a transient failure doesn't permanently
 * block unstick.
 */
async function checkProjectGitRepairState(projectPath: string): Promise<UnstickGitRepairState> {
  try {
    const [divergence, status] = await Promise.all([
      execAsync(
        'git rev-list --left-right --count main...origin/main',
        { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
      ),
      execAsync(
        'git status --porcelain',
        { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
      ),
    ]);
    const [aheadRaw = '0', behindRaw = '0'] = divergence.stdout.trim().split(/\s+/);
    const aheadCount = parseInt(aheadRaw, 10) || 0;
    const behindCount = parseInt(behindRaw, 10) || 0;
    const dirty = status.stdout.trim().length > 0;
    const advice = buildUnstickRepairAdvice(aheadCount, behindCount, dirty);
    return advice ? { safe: false, advice } : { safe: true };
  } catch {
    // If we can't check (no git repo, no origin/main), don't block the operator.
    return { safe: true };
  }
}

export const __testInternals = {
  buildUnstickRepairAdvice,
};
const postWorkspaceResetReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/reset',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const resolved = resolveProjectFromIssueSync(issueId);
    const resetWorkspace = resolveResetWorkspace(issueId, workspaceInfo, resolved);
    const result = processResetReviewPipeline(issueId, resetWorkspace.exists);
    if (result.httpStatus !== 200) {
      return jsonResponse(result.body, { status: result.httpStatus });
    }

    try {
      const { resetPostMergeState } = yield* Effect.promise(() => import(
        '../../../../lib/cloister/merge-agent.js'
      ));
      resetPostMergeState(issueId);
    } catch (err) {
      console.warn(`[reset-review] resetPostMergeState best-effort failed for ${issueId}:`, err);
    }

    console.log(
      `[reset-review] Pipeline state reset for ${issueId} — awaiting agent to request review`
    );

    const rerun = (body as { rerun?: unknown })?.rerun === true;
    if (rerun) {
      try {
        yield* Effect.promise(async () => {
          const { spawnReviewRoleForIssue } = await import('../../../../lib/cloister/review-agent.js');
          const dispatchArgs = buildReviewRedispatchArgs(issueId, resetWorkspace, workspaceInfo, resolved);
          if (dispatchArgs) {
            const result = await Effect.runPromise(spawnReviewRoleForIssue({
              issueId,
              workspace: dispatchArgs.workspace,
              branch: dispatchArgs.branch,
              prUrl: getReviewStatusSync(issueId)?.prUrl,
            }));

            if (result.success) {
              // spawnReviewRoleForIssue already set 'reviewing' + reviewSpawnedAt.
              // PAN-2578: no bare 'reviewing' repeat — it can clobber a fast verdict.
              console.log(`[reset-review] Re-dispatched review for ${issueId}`);
            } else {
              console.warn(
                `[reset-review] Re-dispatch failed for ${issueId}: ${result.message || result.error}`
              );
              setReviewStatus(issueId, { reviewStatus: 'pending' });
            }
          } else {
            console.warn(
              `[reset-review] Could not resolve project for ${issueId}, skipping re-dispatch`
            );
          }
        });
      } catch (rerunErr) {
        console.warn(`[reset-review] Re-dispatch error for ${issueId}: ${rerunErr}`);
        setReviewStatus(issueId, { reviewStatus: 'pending' });
      }
    }

    return jsonResponse({
      success: true,
      message: rerun
        ? `Pipeline reset and review re-dispatched for ${issueId}.`
        : `Review cycles reset for ${issueId}. Agent can now request review when ready.`,
      rerun,
    });
  }))
);
// ─── Route: POST /api/review/:issueId/purge ────────────────────────────────
//
// COMPLETE review reset. Tears down the issue's entire review fleet — the
// agent-<id>-review parent PLUS any leftover extended-review (convoy) sub-reviewers
// (-correctness/-security/-performance/-requirements) — by killing their tmux sessions
// and removing each agent via removeAgentSync (overdeck.db row + state dir, never the
// JSONL transcript), then resets review_status (the pipeline verdict block re-derives
// from it). Use this to clear stale review ghosts left by a prior cycle so a fresh
// review runs clean. Destructive to review-agent state only; confirmed via a dialog.

const postWorkspaceReviewPurgeRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/purge',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: 'Invalid issue ID' }, { status: 400 });
    }

    const { purgeReviewAgentsForIssue } = yield* Effect.promise(
      () => import('../../../../lib/cloister/review-agent.js'),
    );
    const projectKey = resolveProjectFromIssueSync(issueId)?.projectKey;
    const purge = yield* Effect.promise(() => purgeReviewAgentsForIssue(projectKey, issueId));

    // Reset review_status (pipeline verdict block re-derives from it). Only meaningful
    // when the workspace still exists; ghost removal above runs regardless.
    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    let reviewStatusReset = false;
    if (workspaceInfo.exists) {
      processResetReviewPipeline(issueId, true);
      reviewStatusReset = true;
    }

    console.log(
      `[review-purge] ${issueId}: removed=[${purge.removed.join(', ')}] ` +
        `killed=[${purge.killed.join(', ')}] reviewStatusReset=${reviewStatusReset}`,
    );

    return jsonResponse({
      success: true,
      issueId,
      removed: purge.removed,
      killed: purge.killed,
      reviewStatusReset,
      message: `Purged ${purge.removed.length} review agent(s) for ${issueId}.`,
    });
  })),
);
// ─── Route: POST /api/review/:issueId/abort ────────────────────────────────
//
// Kill all running reviewer tmux sessions for an issue and reset reviewStatus
// to 'pending'. Does NOT message the work agent — leaves the worker idle.
// Use this to stop a runaway or stuck review without triggering a resubmit.

const postWorkspaceAbortReviewRoute = HttpRouter.add(
  'POST',
  '/api/review/:issueId/abort',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!issueId) {
      return jsonResponse({ success: false, error: 'Missing issueId' }, { status: 400 });
    }

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    if (!workspaceInfo.exists) {
      return jsonResponse({ success: false, error: 'Workspace does not exist' }, { status: 400 });
    }

    const { resolveProjectFromIssueSync } = yield* Effect.promise(() =>
      import('../../../../lib/projects.js'),
    );
    const { killAllReviewerSessions } = yield* Effect.promise(() =>
      import('../../../../lib/cloister/review-agent.js'),
    );
    const resolved = resolveProjectFromIssueSync(issueId);
    const { killed, failed } = yield* killAllReviewerSessions(resolved?.projectKey, issueId);

    // Reset only reviewStatus — leave test/merge/verification untouched
    setReviewStatus(issueId, {
      reviewStatus: 'pending',
      reviewNotes: undefined,
    });

    console.log(
      `[abort-review] Aborted ${killed.length} reviewer session(s) for ${issueId}` +
      (failed.length ? ` (${failed.length} kill failed)` : '')
    );

    return jsonResponse({
      success: true,
      message: `Aborted ${killed.length} reviewer session(s) for ${issueId}. Worker left idle.`,
      killed,
      failed,
    });
  }))
);
const postWorkspaceUnstickRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/unstick',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);
    const current = getReviewStatusSync(issueId);

    // Pre-verify git state before mutating stuck flag.
    // For main_diverged: check that local main is not ahead of origin/main.
    // PAN-794: review_infrastructure_failure is unrelated to git divergence —
    // skip the git safe-state check so operators can unstick review-infra
    // workspaces without touching the project's main branch.
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const skipGitCheck = current?.stuckReason === 'review_infrastructure_failure';
    const gitRepairState = skipGitCheck
      ? { safe: true } as const
      : yield* Effect.promise(() => checkProjectGitRepairState(projectPath));

    const result = processUnstickRequest(issueId, workspaceInfo.exists, current, gitRepairState);
    return jsonResponse(result.body, result.httpStatus !== 200 ? { status: result.httpStatus } : undefined);
  }))
);
const postWorkspaceDeaconIgnoreRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/deacon-ignore',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    if (!issueId) {
      return jsonResponse({ success: false, error: 'Missing issueId' }, { status: 400 });
    }

    const body = (yield* readJsonBody) as { ignored?: unknown; reason?: unknown };
    if (typeof body.ignored !== 'boolean') {
      return jsonResponse(
        { success: false, error: 'Body must include { ignored: boolean }' },
        { status: 400 },
      );
    }
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : undefined;

    setDeaconIgnored(issueId, body.ignored, reason);
    const updated = getReviewStatusSync(issueId);
    return jsonResponse({
      success: true,
      issueId,
      deaconIgnored: updated?.deaconIgnored ?? body.ignored,
      deaconIgnoredAt: updated?.deaconIgnoredAt,
      deaconIgnoredReason: updated?.deaconIgnoredReason,
    });
  }))
);
const postWorkspaceAutoMergeRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/auto-merge',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = (params['issueId'] ?? '').toUpperCase();
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const body = (yield* readJsonBody) as { autoMerge?: unknown };
    if (typeof body.autoMerge !== 'boolean' && body.autoMerge !== null) {
      return jsonResponse(
        { success: false, error: 'Body must include { autoMerge: boolean | null }' },
        { status: 400 },
      );
    }

    setAutoMerge(issueId, body.autoMerge);
    const updated = getReviewStatusSync(issueId);
    return jsonResponse({
      success: true,
      issueId,
      autoMerge: updated?.autoMerge ?? null,
    });
  }))
);
// ─── Route: DELETE /api/review/:issueId/pending ──────────────────────────

const deleteWorkspacePendingRoute = HttpRouter.add(
  'DELETE',
  '/api/review/:issueId/pending',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    clearPendingOperation(issueId);
    return jsonResponse({ success: true });
  }))
);

export const reviewControlRouteLayer = Layer.mergeAll(
  postWorkspaceResetReviewRoute,
  postWorkspaceReviewPurgeRoute,
  postWorkspaceAbortReviewRoute,
  postWorkspaceUnstickRoute,
  postWorkspaceDeaconIgnoreRoute,
  postWorkspaceAutoMergeRoute,
  deleteWorkspacePendingRoute,
);

export default reviewControlRouteLayer;
