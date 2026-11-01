/**
 * `GET /api/costs/request-digest` (PAN-4651 FR-8, D-4651-19, `read:costs`):
 * this machine's month of provider requests as `[hash, ts ms, cost]`, so a
 * linked machine's fleet usage counts a request recorded here and there once.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { readRequestDigest } from '../../../lib/costs/request-digest.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const getRequestDigestRoute = HttpRouter.add(
  'GET',
  '/api/costs/request-digest',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(yield* Effect.promise(() => readRequestDigest()));
  })),
);

export const costsDigestRouteLayer = Layer.mergeAll(getRequestDigestRoute);
