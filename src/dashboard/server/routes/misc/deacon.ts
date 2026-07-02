import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { applyBootReconciliationDecision } from '../../../../lib/cloister/deacon.js';
import { getCloisterService } from '../../../../lib/cloister/service.js';
import {
  getBootReconciliationState,
  isDeaconGloballyPausedSync as isDeaconGloballyPaused,
  setBootReconciliationDecision,
  setDeaconGloballyPausedSync as setDeaconGloballyPaused,
} from '../../../../lib/overdeck/control-settings.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import { readJsonBody } from './shared.js';

const getNoResumeModeRoute = HttpRouter.add(
  'GET',
  '/api/no-resume-mode',
  Effect.sync(() => {
    const state = getBootReconciliationState();
    const active = state.decision === 'pending' || state.decision === 'hold_all';
    return jsonResponse({ active, since: active ? state.decidedAt ?? state.graceDeadline : null });
  }),
);

const postResumeAllRoute = HttpRouter.add(
  'POST',
  '/api/resume-all',
  Effect.promise(async () => {
    try {
      setBootReconciliationDecision('resume_all');
      const resumed = await applyBootReconciliationDecision();
      console.log(`[resume-all] Boot reconciliation decision set to resume_all; resumed ${resumed.length} work agent(s)${resumed.length ? `: ${resumed.join(', ')}` : ''}`);
      return jsonResponse({ ok: true, resumed, count: resumed.length });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error resuming all agents:', error);
      return jsonResponse(
        { ok: false, error: 'Failed to resume agents: ' + msg },
        { status: 500 },
      );
    }
  }),
);

// ─── Route: GET /api/deacon/status ───────────────────────────────────────────

const getDeaconStatusRoute = HttpRouter.add(
  'GET',
  '/api/deacon/status',
  Effect.try({
    try: () => {
      const service = getCloisterService();
      const status = service.getDeaconStatus();
      const lastPatrol = service.getLastPatrolResult();
      return jsonResponse({
        ...status,
        lastPatrol: lastPatrol
          ? {
              cycle: lastPatrol.cycle,
              timestamp: lastPatrol.timestamp,
              actions: lastPatrol.actionsToken,
              massDeathDetected: lastPatrol.massDeathDetected,
            }
          : null,
      });
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
        const service = getCloisterService();
        const logs = service.getDeaconLogs(Math.min(limit, 200));
        return jsonResponse({ logs });
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
      const service = getCloisterService();
      const result = await service.runDeaconPatrol();
      return jsonResponse(result);
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
  getNoResumeModeRoute,
  postResumeAllRoute,
  getDeaconStatusRoute,
  getDeaconLogsRoute,
  postDeaconPatrolRoute,
  getDeaconPauseRoute,
  postDeaconPauseRoute,
);
