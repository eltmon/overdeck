import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  isDeaconGloballyPaused,
  setDeaconGloballyPaused,
} from '../../../../lib/overdeck/control-settings.js';
import {
  readDurableDeaconLogs,
  readDurableDeaconStatus,
  requestDurablePatrol,
} from '../../services/cloister-control-surface.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { readJsonBody } from './shared.js';

// PAN-3917: `GET /api/no-resume-mode` and `POST /api/resume-all` are gone with
// boot reconciliation (D7, A.1). There is no stored resume decision to hold or
// apply: a pane's liveness is the terminal backend's answer, read live.

// ─── Route: GET /api/deacon/status ───────────────────────────────────────────

const getDeaconStatusRoute = HttpRouter.add(
  'GET',
  '/api/deacon/status',
  Effect.try({
    try: () => {
      return jsonResponse(readDurableDeaconStatus());
    },
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error getting deacon status:', error);
      return jsonResponse(
        { error: 'Failed to get deacon status: ' + msg },
        { status: 500 },
      );
    },
  }),
);

// ─── Route: GET /api/deacon/logs ─────────────────────────────────────────────

const getDeaconLogsRoute = HttpRouter.add(
  'GET',
  '/api/deacon/logs',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 100;

    return yield* Effect.try({
      try: () => {
        return jsonResponse({ logs: readDurableDeaconLogs(limit) });
      },
      catch: (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Error getting deacon logs:', error);
        return jsonResponse(
          { error: 'Failed to get deacon logs: ' + msg },
          { status: 500 },
        );
      },
    });
  }),
);

// ─── Route: POST /api/deacon/patrol ──────────────────────────────────────────

const postDeaconPatrolRoute = HttpRouter.add(
  'POST',
  '/api/deacon/patrol',
  Effect.promise(async () => {
    try {
      const result = requestDurablePatrol();
      if (!result.accepted) {
        return jsonResponse({ error: 'Deacon child is not running' }, { status: 504 });
      }
      return jsonResponse({ ok: true, accepted: true });
    }    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error running deacon patrol:', error);
      return jsonResponse(
        { error: 'Failed to run patrol: ' + msg },
        { status: 500 },
      );
      }}),
);

// ─── Route: GET /api/deacon/pause ────────────────────────────────────────────

/**
 * Read the persisted global Deacon pause flag. Distinct from runtime `isRunning`:
 * paused means the patrol timer still fires but every cycle short-circuits.
 */
const getDeaconPauseRoute = HttpRouter.add(
  'GET',
  '/api/deacon/pause',
  Effect.try({
    try: () => jsonResponse({ paused: isDeaconGloballyPaused() }),
    catch: (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: 'Failed to read deacon pause flag: ' + msg }, { status: 500 });
    },
  }),
);

// ─── Route: POST /api/deacon/pause ───────────────────────────────────────────

/**
 * Toggle the persisted global Deacon pause flag. Body: `{ paused: boolean }`.
 * Persists to `app_settings` so the flag survives dashboard restarts.
 */
const postDeaconPauseRoute = HttpRouter.add(
  'POST',
  '/api/deacon/pause',
  httpHandler(Effect.gen(function* () {
    const body = (yield* readJsonBody) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') {
      return jsonResponse({ error: 'Body must include { paused: boolean }' }, { status: 400 });
    }
    setDeaconGloballyPaused(body.paused);
    console.log(`[deacon] Global pause flag set to ${body.paused}`);
    return jsonResponse({ paused: isDeaconGloballyPaused() });
  })),
);

export const deaconRouteLayer = Layer.mergeAll(
  getDeaconStatusRoute,
  getDeaconLogsRoute,
  postDeaconPatrolRoute,
  getDeaconPauseRoute,
  postDeaconPauseRoute,
);
