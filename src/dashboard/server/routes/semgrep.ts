/**
 * Semgrep settings routes (PAN-4594) — Effect HttpRouter.Layer.
 *
 * Thin wrapper over src/lib/semgrep/settings.ts (the path-scoped config.yaml door),
 * modeled on routes/jev.ts.
 *
 *   GET /api/semgrep/settings — current security.semgrep view plus pinnedVersion
 *   PUT /api/semgrep/settings — body: a partial patch of security.semgrep keys
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

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

export const semgrepRouteLayer = Layer.mergeAll(getSemgrepSettingsRoute, putSemgrepSettingsRoute);
