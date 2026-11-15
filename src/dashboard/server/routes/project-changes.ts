/**
 * GET /api/projects/:projectKey/changes?since= (PAN-5288): recent commits on
 * the project's default branch with who made them. `since` is `<n>d`, `<n>h`
 * or a date, at most 90 days back (default 7 days). No route-scopes row, so
 * it stays `admin`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { getProjectChanges, parseSince } from '../../../lib/overdeck/project-changes.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const getProjectChangesRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/changes',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const since = parseSince(url.searchParams.get('since'), Date.now());
    if (!since.ok) return jsonResponse({ error: 'Invalid since' }, { status: 400 });
    const result = yield* Effect.promise(() => getProjectChanges(params['projectKey'] ?? '', { sinceIso: since.iso }));
    return jsonResponse(result.body, { status: result.status });
  })),
);

export const projectChangesRouteLayer = Layer.mergeAll(getProjectChangesRoute);
