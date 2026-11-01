/**
 * `GET /api/settings/resolved` (PAN-4651 FR-9, D-4651-20, `read:settings`):
 * this machine's explicitly set `config.yaml` keys as `{ settings }`, secrets
 * only as set or not set, for a linked machine's Compare settings.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { readResolvedSettings } from '../../../lib/settings-resolved.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';

const getResolvedSettingsRoute = HttpRouter.add(
  'GET',
  '/api/settings/resolved',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    return jsonResponse({ settings: yield* Effect.promise(() => readResolvedSettings()) });
  }),
);

export const settingsResolvedRouteLayer = Layer.mergeAll(getResolvedSettingsRoute);
