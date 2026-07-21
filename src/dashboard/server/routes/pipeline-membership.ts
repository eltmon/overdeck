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
    const message = snapshot?.error instanceof Error
      ? snapshot.error.message
      : 'Pipeline membership snapshot is loading';
    return jsonResponse({ error: message }, { status: 503 });
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
    const message = snapshot?.error instanceof Error
      ? snapshot.error.message
      : 'Pipeline membership refresh failed';
    return jsonResponse({ error: message }, { status: 502 });
  })),
);

// ─── Compose all routes into a single Layer ───────────────────────────────────

export const pipelineMembershipRouteLayer = Layer.mergeAll(
  getPipelineMembershipRoute,
  postPipelineMembershipRefreshRoute,
);

export default pipelineMembershipRouteLayer;
