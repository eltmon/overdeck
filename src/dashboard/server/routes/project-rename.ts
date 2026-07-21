import { Effect } from 'effect';
import * as Result from 'effect/Result';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { ProjectRenameError, renameProject } from '../../../lib/projects.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
});

export const postProjectRenameRoute = HttpRouter.add(
  'POST',
  '/api/projects/:projectKey/rename',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const projectIdentifier = (yield* HttpRouter.params)['projectKey'] ?? '';
    const body = (yield* readJsonBody) as { name?: unknown };
    if (typeof body.name !== 'string') {
      return jsonResponse({ error: 'Project name must be a string' }, { status: 400 });
    }

    const result = yield* Effect.result(renameProject(projectIdentifier, body.name));
    if (Result.isFailure(result)) {
      if (!(result.failure instanceof ProjectRenameError)) {
        return yield* Effect.fail(result.failure);
      }
      if (result.failure.reason === 'not-found') {
        return jsonResponse({ error: 'Project not found' }, { status: 404 });
      }
      if (result.failure.reason === 'empty') {
        return jsonResponse({ error: result.failure.message }, { status: 400 });
      }
      return jsonResponse({ error: result.failure.message }, { status: 409 });
    }

    return jsonResponse(result.success);
  })),
);
