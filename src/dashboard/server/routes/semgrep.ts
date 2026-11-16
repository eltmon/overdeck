/**
 * Semgrep settings routes (PAN-4594) — Effect HttpRouter.Layer.
 *
 * Thin wrapper over src/lib/semgrep/settings.ts (the path-scoped config.yaml door),
 * modeled on routes/jev.ts.
 *
 *   GET  /api/semgrep/settings               — current security.semgrep view plus pinnedVersion
 *   PUT  /api/semgrep/settings               — body: a partial patch of security.semgrep keys
 *   GET  /api/projects/:projectKey/sast      — per-project verification.sast value + effective mode
 *   POST /api/projects/:projectKey/sast      — body: { value: 'off'|'advisory'|'blocking'|null }
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { loadConfigNoMigration } from '../../../lib/config-yaml/load.js';
import { SEMGREP_GATE_MODES, type SemgrepGateMode } from '../../../lib/config-yaml/semgrep.js';
import { getProject } from '../../../lib/projects.js';
import { projectSastView, setProjectSastOverride } from '../../../lib/semgrep/project-override.js';
import { readSemgrepSettings, saveSemgrepSettings, SemgrepSettingsValidationError } from '../../../lib/semgrep/settings.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

const getSemgrepSettingsRoute = HttpRouter.add(
  'GET',
  '/api/semgrep/settings',
  httpHandler(Effect.promise(async () => {
    try {
      return jsonResponse(await readSemgrepSettings());
    } catch (err) {
      if (err instanceof SemgrepSettingsValidationError) {
        return jsonResponse({ error: err.message }, { status: 422 });
      }
      throw err;
    }
  })),
);

const putSemgrepSettingsRoute = HttpRouter.add(
  'PUT',
  '/api/semgrep/settings',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await saveSemgrepSettings(body));
      } catch (err) {
        if (err instanceof SemgrepSettingsValidationError) {
          return jsonResponse({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    });
  })),
);

const getProjectSastRoute = HttpRouter.add(
  'GET',
  '/api/projects/:projectKey/sast',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    const project = yield* getProject(key);
    if (!project) return jsonResponse({ error: 'Project not found' }, { status: 404 });
    const { config } = yield* Effect.promise(() => loadConfigNoMigration());
    return jsonResponse(projectSastView(project, config.security.semgrep));
  })),
);

const postProjectSastRoute = HttpRouter.add(
  'POST',
  '/api/projects/:projectKey/sast',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    const params = yield* HttpRouter.params;
    const key = params['projectKey'] ?? '';
    const project = yield* getProject(key);
    if (!project) return jsonResponse({ error: 'Project not found' }, { status: 404 });

    const body = (yield* readJsonBody) as { value?: unknown };
    const value = body.value;
    if (value !== null && !(SEMGREP_GATE_MODES as readonly unknown[]).includes(value)) {
      return jsonResponse({ error: "value must be 'off', 'advisory', 'blocking', or null" }, { status: 400 });
    }

    yield* Effect.promise(() => setProjectSastOverride(key, value as SemgrepGateMode | null));
    const updated = yield* getProject(key);
    const { config } = yield* Effect.promise(() => loadConfigNoMigration());
    return jsonResponse(projectSastView(updated!, config.security.semgrep));
  })),
);

export const semgrepRouteLayer = Layer.mergeAll(
  getSemgrepSettingsRoute,
  putSemgrepSettingsRoute,
  getProjectSastRoute,
  postProjectSastRoute,
);
