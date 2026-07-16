import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { listProjectsSync, renameProjectSync } from '../../../lib/projects.js';
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

    const projectKey = (yield* HttpRouter.params)['projectKey'] ?? '';
    const projects = listProjectsSync();
    const project = projects.find(({ key }) => key === projectKey)
      ?? projects.find(({ config }) => config.name === projectKey);
    if (!project) return jsonResponse({ error: 'Project not found' }, { status: 404 });

    const body = (yield* readJsonBody) as { name?: unknown };
    if (typeof body.name !== 'string') {
      return jsonResponse({ error: 'Project name must be a string' }, { status: 400 });
    }

    try {
      renameProjectSync(project.key, body.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Unknown project:')) {
        return jsonResponse({ error: message }, { status: 404 });
      }
      if (message === 'Project name must not be empty') {
        return jsonResponse({ error: message }, { status: 400 });
      }
      if (message.includes('conflicts with existing project')) {
        return jsonResponse({ error: message }, { status: 409 });
      }
      throw err;
    }

    return jsonResponse({ key: project.key, name: body.name.trim() });
  })),
);
