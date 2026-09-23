/**
 * Review-control route module — extracted from routes/workspaces.ts (B / wave 2, seam 3b).
 *
 * Operator control endpoints over the review fleet:
 *   POST   /api/review/:issueId/purge
 *   POST   /api/review/:issueId/abort
 *   DELETE /api/review/:issueId/pending
 *
 * The dispatch routes (trigger, request) live in review-pipeline.ts. Shared
 * singletons (project path, readJsonBody, workspace info) stay owned by
 * ../workspaces.js.
 *
 * PAN-3917: what survives here is the set of controls that do something real —
 * kill reviewer sessions, remove reviewer agents, clear the in-memory pending
 * operation. Every control whose whole effect was rewriting a status row is
 * deleted: `reset` and `resync` edited the review-status row, `unstick`
 * cleared its `stuck` field (stuck is a derived attention state now, and it
 * clears itself when the agent pushes), `deacon-ignore` set `deaconIgnored`
 * (deacon-lite has four routines and no per-issue ignore list, FR-11),
 * `auto-merge` set the per-issue `autoMerge` key (the merge train gates on
 * project default plus the global require-UAT flag, D3), and
 * `GET/POST /config` read and wrote the record's `reviewMode`/`reviewModel`
 * overrides (review mode and model resolve from project and global config).
 */

import { join } from 'node:path';

import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { parseIssueIdSync } from '../../../../lib/issue-id.js';
import { findWorkspacePath } from '../../../../lib/lifecycle/archive-planning.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  clearPendingOperation,
  getWorkspaceInfoForIssue,
} from '../workspaces.js';

/**
 * Resolve whether a workspace exists for the review-control endpoints,
 * including strike workspaces (feature-<id>-strike) that
 * getWorkspaceInfoForIssue does not yet know about. PAN-2270 regression hook.
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
 * Build the workspace/branch pair for a review re-dispatch, handling strike
 * workspaces (feature-<id>-strike -> strike/<id>) and preserving the existing
 * feature/<numeric> convention for non-strike workspaces.
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

// ─── Route: POST /api/review/:issueId/purge ────────────────────────────────
//
// Tears down the issue's entire review fleet — the agent-<id>-review parent
// PLUS any leftover extended-review (convoy) sub-reviewers
// (-correctness/-security/-performance/-requirements) — by killing their tmux
// sessions and removing each agent through the transcript-preserving removal
// path. Use this to clear stale review ghosts left by a prior cycle so a fresh
// review runs clean. Destructive to review-agent sessions only; confirmed via a
// dialog. PAN-3917: there is no status row to reset afterwards — the PR's
// review state is the verdict, and re-review is requested through
// `/api/review/:issueId/request`.

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

    console.log(
      `[review-purge] ${issueId}: removed=[${purge.removed.join(', ')}] ` +
        `killed=[${purge.killed.join(', ')}]`,
    );

    return jsonResponse({
      success: true,
      issueId,
      removed: purge.removed,
      killed: purge.killed,
      message: `Purged ${purge.removed.length} review agent(s) for ${issueId}.`,
    });
  })),
);
// ─── Route: POST /api/review/:issueId/abort ────────────────────────────────
//
// Kill all running reviewer tmux sessions for an issue. Does NOT message the
// work agent — leaves the worker idle. Use this to stop a runaway or stuck
// review without triggering a resubmit. PAN-3917: killing the sessions is the
// whole effect; the PR keeps whatever review state the forge holds.

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
    const { killed, failed } = yield* Effect.promise(() => killAllReviewerSessions(resolved?.projectKey, issueId));

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
  postWorkspaceReviewPurgeRoute,
  postWorkspaceAbortReviewRoute,
  deleteWorkspacePendingRoute,
);

export default reviewControlRouteLayer;
