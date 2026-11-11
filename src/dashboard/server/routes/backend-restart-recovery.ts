/**
 * PAN-5091: the terminal-backend restart recovery offer.
 *
 * - `GET /api/backend-restart-recovery` (`read:conversations`): the
 *   conversations the last backend restart left stopped, and the latest Resume
 *   all run.
 * - `POST /api/backend-restart-recovery/resume-all` (`operate`): resume them
 *   one at a time in the background; 202, or 409 while a run is in progress or
 *   when there is nothing to resume.
 * - `POST /api/backend-restart-recovery/dismiss` (`operate`): drop the offer;
 *   409 while Resume all runs.
 *
 * Kept off `/api/conversations/:name` so no path segment reads as a name.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import {
  dismissBackendRestartRecovery,
  getBackendRestartRecoverySnapshot,
  startBackendRestartResumeAll,
} from '../services/backend-restart-recovery.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

const getRecoveryRoute = HttpRouter.add(
  'GET',
  '/api/backend-restart-recovery',
  httpHandler(Effect.promise(async () => jsonResponse(await getBackendRestartRecoverySnapshot()))),
);

const resumeAllRoute = HttpRouter.add(
  'POST',
  '/api/backend-restart-recovery/resume-all',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const result = yield* Effect.promise(() => startBackendRestartResumeAll());
    if (result.started) return jsonResponse(result, { status: 202 });
    const error = result.reason === 'running'
      ? 'Resume all is already running'
      : 'No conversations are waiting to be resumed after a terminal-backend restart';
    return jsonResponse({ error, code: result.reason }, { status: 409 });
  })),
);

const dismissRoute = HttpRouter.add(
  'POST',
  '/api/backend-restart-recovery/dismiss',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    if (dismissBackendRestartRecovery()) return jsonResponse({ dismissed: true });
    return jsonResponse({ error: 'Resume all is running; dismiss it when it finishes', code: 'running' }, { status: 409 });
  })),
);

export const backendRestartRecoveryRouteLayer = Layer.mergeAll(getRecoveryRoute, resumeAllRoute, dismissRoute);
