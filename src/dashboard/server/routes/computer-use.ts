/**
 * Computer-use settings routes (PAN-5461) — Effect HttpRouter.Layer.
 *
 * Thin wrapper over src/lib/computer-use/{status,setup,settings,run}.ts, modeled
 * on routes/semgrep.ts. Every route is admin-only (no route-scopes.ts row, D-8),
 * so an agent's scoped token can't turn computer use on. Mutations call the
 * mutation guard first. The setup and release bodies are never read (D-3).
 *
 *   GET  /api/computer-use/status    — ComputerUseStatusView for the host
 *   POST /api/computer-use/setup     — run the listed setup steps
 *   PUT  /api/computer-use/settings  — body: { enabled: boolean }
 *   POST /api/computer-use/release   — force-release the desktop lease
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { runRelease } from '../../../lib/computer-use/run.js';
import {
  ComputerUseConfigSyntaxError,
  ComputerUseSettingsValidationError,
  saveComputerUseSettings,
} from '../../../lib/computer-use/settings.js';
import { runSetup, SetupInProgressError } from '../../../lib/computer-use/setup.js';
import { buildStatus } from '../../../lib/computer-use/status.js';
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

/** The status view, or 422 when config.yaml has a YAML syntax error. */
async function statusResponse() {
  try {
    return jsonResponse(await buildStatus({ probeHelper: 'if-free' }));
  } catch (err) {
    if (err instanceof ComputerUseConfigSyntaxError) return jsonResponse({ error: err.message }, { status: 422 });
    throw err;
  }
}

const getStatusRoute = HttpRouter.add(
  'GET',
  '/api/computer-use/status',
  httpHandler(Effect.promise(() => statusResponse())),
);

const postSetupRoute = HttpRouter.add(
  'POST',
  '/api/computer-use/setup',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await runSetup());
      } catch (err) {
        if (err instanceof SetupInProgressError) return jsonResponse({ error: 'Setup is already running' }, { status: 409 });
        if (err instanceof ComputerUseConfigSyntaxError) return jsonResponse({ error: err.message }, { status: 422 });
        throw err;
      }
    });
  })),
);

const putSettingsRoute = HttpRouter.add(
  'PUT',
  '/api/computer-use/settings',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      try {
        await saveComputerUseSettings(body);
      } catch (err) {
        if (err instanceof ComputerUseSettingsValidationError) return jsonResponse({ error: err.message }, { status: 400 });
        if (err instanceof ComputerUseConfigSyntaxError) return jsonResponse({ error: err.message }, { status: 422 });
        throw err;
      }
      return statusResponse();
    });
  })),
);

const postReleaseRoute = HttpRouter.add(
  'POST',
  '/api/computer-use/release',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;

    return yield* Effect.promise(async () => {
      await runRelease({ force: true });
      return statusResponse();
    });
  })),
);

export const computerUseRouteLayer = Layer.mergeAll(getStatusRoute, postSetupRoute, putSettingsRoute, postReleaseRoute);
