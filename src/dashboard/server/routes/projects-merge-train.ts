/** PAN-1696: Per-project merge-train override endpoints (GET/POST) */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { httpHandler } from './http-handler.js';
import { jsonResponse } from '../http-helpers.js';
import { getProjectSync, setProjectMergeTrain } from '../../../lib/projects.js';
import { readProjectJsonBody } from './projects.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

// ─── Route: GET /api/projects/:projectKey/merge-train ────────────────
// PAN-1696: get per-project merge-train override (enabled/disabled/null) and effective state.
const getProjectMergeTrainRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/merge-train',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    const config = getProjectSync(key);
    if (!config) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    const { isMergeTrainEnabledForProject } = yield* Effect.promise(() => import('../../../lib/overdeck/merge-sync.js'));
    return jsonResponse({
      value: config.merge_train ?? null,
      effective: isMergeTrainEnabledForProject(config),
    });
  })),
);

// ─── Route: POST /api/projects/:projectKey/merge-train ────────────────
// PAN-1696: set per-project merge-train override ('enabled' | 'disabled' | null).
const postProjectMergeTrainRoute = HttpRouter.add(
  'POST',
  '/api/projects/:projectKey/merge-train',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    const project = getProjectSync(key);
    if (!project) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    const body = (yield* readProjectJsonBody) as { value?: unknown };
    const v = body.value;
    if (v !== 'enabled' && v !== 'disabled' && v !== null) {
      return jsonResponse({ error: "value must be 'enabled', 'disabled', or null" }, { status: 400 });
    }
    const { isMergeTrainEnabledForProject } = yield* Effect.promise(() => import('../../../lib/overdeck/merge-sync.js'));
    yield* Effect.promise(() => setProjectMergeTrain(key, v));
    const updated = { ...project };
    if (v === null) delete updated.merge_train;
    else updated.merge_train = v;
    return jsonResponse({
      value: v,
      effective: isMergeTrainEnabledForProject(updated),
    });
  })),
);

export const projectsMergeTrainRouteLayer = Layer.mergeAll(
  getProjectMergeTrainRoute,
  postProjectMergeTrainRoute,
);

export default projectsMergeTrainRouteLayer;
