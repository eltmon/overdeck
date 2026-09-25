import {
  PIPELINE_MEMBERSHIP_LOADING_CODE,
  type PipelineMembershipLoadingBody,
  type PipelineMembershipUnavailableBody,
} from '@overdeck/contracts';

import { jsonResponse } from "../http-helpers.js";
import { httpHandler } from './http-handler.js';
/**
 * Pipeline-membership route module — the dashboard read/retry doors over the
 * cached membership snapshots (docs/PIPELINE-MEMBERSHIP.md).
 *
 * Endpoints:
 *   GET  /api/pipeline/membership?project=<key>          — snapshot read only
 *   POST /api/pipeline/membership/refresh?project=<key>  — operator retry (PAN-2972)
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getProjectSync } from '../../../lib/projects.js';
import {
  readPipelineMembershipSnapshotsForProjects,
  refreshMembershipSnapshotsForProjects,
} from '../services/pipeline-membership.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

/**
 * PAN-3527 — seconds a client should wait before re-reading a snapshot that is
 * still loading. Boot warms every project's snapshot in the background, so the
 * answer changes within seconds, not minutes.
 */
export const PIPELINE_MEMBERSHIP_LOADING_RETRY_AFTER_SECONDS = 5;

/**
 * PAN-3527 — seconds a client should wait before re-reading a snapshot whose
 * gather failed because the forge did not answer (`forge_transient`: rate
 * limit, 5xx, timeout, network). Resource refreshes keep re-gathering a cold
 * snapshot, so the next read can succeed without an operator click.
 */
export const PIPELINE_MEMBERSHIP_FORGE_TRANSIENT_RETRY_AFTER_SECONDS = 30;

// ─── Route: GET /api/pipeline/membership ──────────────────────────────────────

const getPipelineMembershipRoute = HttpRouter.add(
  'GET',
  '/api/pipeline/membership',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const projectKey = new URL(request.url, 'http://localhost').searchParams.get('project');
    if (!projectKey) return jsonResponse({ error: 'project query parameter is required' }, { status: 400 });
    const project = getProjectSync(projectKey);
    if (!project) return jsonResponse({ error: `Project not found: ${projectKey}` }, { status: 404 });
    // Request handlers are snapshot readers only. A cold server returns a fast
    // unavailable response while boot/event refreshes populate the cache; it
    // never launches tracker or git discovery from the operator's click.
    // Operator-initiated retries go through POST /api/pipeline/membership/refresh.
    const snapshot = readPipelineMembershipSnapshotsForProjects([project])[0];
    if (snapshot?.memberships) return jsonResponse(snapshot.memberships);
    if (snapshot?.error && snapshot.unavailableReason) {
      const body: PipelineMembershipUnavailableBody = {
        status: 'unavailable',
        reason: snapshot.unavailableReason ?? 'gather_failed',
        message: snapshot.error instanceof Error ? snapshot.error.message : String(snapshot.error),
        projectKey,
      };
      // PAN-3527: a forge that did not answer is not an answer about the
      // project. 503 + Retry-After makes the dashboard retry it instead of
      // latching the settled banner; `error` is the text the banner shows.
      if (body.reason === 'forge_transient') {
        return jsonResponse({ ...body, error: body.message }, {
          status: 503,
          headers: { 'Retry-After': String(PIPELINE_MEMBERSHIP_FORGE_TRANSIENT_RETRY_AFTER_SECONDS) },
        });
      }
      return jsonResponse(body);
    }
    // PAN-3527: "not gathered yet" is temporary, not an answer about the
    // project. A typed code and Retry-After let the dashboard retry it instead
    // of latching it as the settled "could not be loaded" banner.
    const loading: PipelineMembershipLoadingBody = {
      status: 'loading',
      code: PIPELINE_MEMBERSHIP_LOADING_CODE,
      error: 'Pipeline membership snapshot is loading',
      projectKey,
    };
    return jsonResponse(loading, {
      status: 503,
      headers: { 'Retry-After': String(PIPELINE_MEMBERSHIP_LOADING_RETRY_AFTER_SECONDS) },
    });
  })),
);

// ─── Route: POST /api/pipeline/membership/refresh ─────────────────────────────
// PAN-2972 — the "Retry membership" button. A cold snapshot cannot be healed by
// re-reading it, so an explicit operator retry forces a re-gather NOW (same
// policy as the PAN-2893 event-driven refresh) and returns the fresh result.

const postPipelineMembershipRefreshRoute = HttpRouter.add(
  'POST',
  '/api/pipeline/membership/refresh',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const projectKey = new URL(request.url, 'http://localhost').searchParams.get('project');
    if (!projectKey) return jsonResponse({ error: 'project query parameter is required' }, { status: 400 });
    const project = getProjectSync(projectKey);
    if (!project) return jsonResponse({ error: `Project not found: ${projectKey}` }, { status: 404 });
    yield* Effect.promise(() => refreshMembershipSnapshotsForProjects([project]));
    const snapshot = readPipelineMembershipSnapshotsForProjects([project])[0];
    if (snapshot?.memberships) return jsonResponse(snapshot.memberships);
    const body: PipelineMembershipUnavailableBody = {
      status: 'unavailable',
      reason: snapshot?.unavailableReason ?? 'gather_failed',
      message: snapshot?.error instanceof Error
        ? snapshot.error.message
        : 'Pipeline membership refresh failed',
      projectKey,
    };
    return jsonResponse(body);
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const pipelineMembershipRouteLayer = Layer.mergeAll(
  getPipelineMembershipRoute,
  postPipelineMembershipRefreshRoute,
);

export default pipelineMembershipRouteLayer;
