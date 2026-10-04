/**
 * Jev settings and usage routes (PAN-4508) — Effect HttpRouter.Layer.
 *
 * Thin wrappers over src/lib/jev/settings.ts (the path-scoped config.yaml door) and
 * src/lib/jev/usage-log.ts, modeled on routes/model-presets.ts.
 *
 *   GET /api/jev/settings — current route/model/timeout/apiKeyRef view
 *   PUT /api/jev/settings — body { route, model, timeoutMs }
 *   GET /api/jev/usage    — 24h calls/lastCallAt/lastError per Jev feature
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { JevSettingsValidationError, readJevSettings, saveJevSettings } from '../../../lib/jev/settings.js';
import { readJevUsageSummary } from '../../../lib/jev/usage-log.js';
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

const getJevSettingsRoute = HttpRouter.add(
  'GET',
  '/api/jev/settings',
  httpHandler(Effect.promise(async () => jsonResponse(await readJevSettings()))),
);

const putJevSettingsRoute = HttpRouter.add(
  'PUT',
  '/api/jev/settings',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await saveJevSettings(body));
      } catch (err) {
        if (err instanceof JevSettingsValidationError) {
          return jsonResponse({ error: err.message, errors: err.errors }, { status: 400 });
        }
        throw err;
      }
    });
  })),
);

const getJevUsageRoute = HttpRouter.add(
  'GET',
  '/api/jev/usage',
  httpHandler(Effect.promise(async () => jsonResponse(await readJevUsageSummary()))),
);

export const jevRouteLayer = Layer.mergeAll(getJevSettingsRoute, putJevSettingsRoute, getJevUsageRoute);
