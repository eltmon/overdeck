/**
 * Restart-gate routes (PAN-3729) — the pinned wire contract for voluntary
 * dashboard restarts.
 *
 *   POST /api/restart-gate/requests  upsert + poll + TTL refresh (every 5s)
 *   POST /api/restart-gate/claim     take the exclusive right to restart
 *   POST /api/restart-gate/approve   operator approval (banner, `pan restart approve`)
 *   GET  /api/restart-gate           read door for the current gate
 *
 * These handlers are deliberately thin: every state transition happens inside
 * `services/restart-gate.ts`, the one writer for gate state. Nothing here
 * touches the gate file.
 *
 * A requester that gets 404 from these paths is talking to a server built
 * before this feature and proceeds ungated — that compat rule is what lets the
 * gate itself be deployed through an ungated restart.
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import type { RestartGateKind } from '@overdeck/contracts';

import { jsonResponse } from '../http-helpers.js';
import { getRestartGate } from '../services/restart-gate.js';
import { httpHandler } from './http-handler.js';

const VALID_KINDS: readonly RestartGateKind[] = ['deploy', 'reload', 'restart'];

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
});

const postRequestRoute = HttpRouter.add(
  'POST',
  '/api/restart-gate/requests',
  httpHandler(
    Effect.gen(function* () {
      const body = yield* readJsonBody;
      const requesterId = typeof body['requesterId'] === 'string' ? body['requesterId'].trim() : '';
      const kind = body['kind'];
      const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
      const builtSha = typeof body['builtSha'] === 'string' ? body['builtSha'] : undefined;

      if (!requesterId) {
        return jsonResponse({ error: 'requesterId is required' }, { status: 400 });
      }
      if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as RestartGateKind)) {
        return jsonResponse(
          { error: `kind must be one of: ${VALID_KINDS.join(', ')}` },
          { status: 400 },
        );
      }

      const result = yield* Effect.promise(() =>
        getRestartGate().request({
          requesterId,
          kind: kind as RestartGateKind,
          reason,
          ...(builtSha === undefined ? {} : { builtSha }),
        }),
      );
      return jsonResponse(result);
    }),
  ),
);

const postClaimRoute = HttpRouter.add(
  'POST',
  '/api/restart-gate/claim',
  httpHandler(
    Effect.gen(function* () {
      const body = yield* readJsonBody;
      const requesterId = typeof body['requesterId'] === 'string' ? body['requesterId'].trim() : '';
      if (!requesterId) {
        return jsonResponse({ error: 'requesterId is required' }, { status: 400 });
      }
      const result = yield* Effect.promise(() => getRestartGate().claim(requesterId));
      return jsonResponse(result);
    }),
  ),
);

const postApproveRoute = HttpRouter.add(
  'POST',
  '/api/restart-gate/approve',
  httpHandler(
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => getRestartGate().approve());
      return jsonResponse(result);
    }),
  ),
);

const getRestartGateRoute = HttpRouter.add(
  'GET',
  '/api/restart-gate',
  httpHandler(
    Effect.gen(function* () {
      const snapshot = yield* Effect.promise(() => getRestartGate().read());
      return jsonResponse(snapshot);
    }),
  ),
);

export const restartGateRouteLayer = Layer.mergeAll(
  postRequestRoute,
  postClaimRoute,
  postApproveRoute,
  getRestartGateRoute,
);
