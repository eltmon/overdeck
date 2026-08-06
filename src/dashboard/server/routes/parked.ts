/**
 * Parked-population route — the dashboard read door over
 * resolveParkedPopulation() (PAN-3485 phase 1).
 *
 * Endpoints:
 *   GET /api/parked — the current parked rows, oldest first (read only)
 *
 * The resolve pass is bounded to the in-flight universe (review_status rows ∪
 * registered agents, ~dozens), so a per-request resolve is cheap; there is no
 * cache to drift. Rows contain no secrets — no auth gate needed beyond the
 * standard unsafe-mutation rejection (this route is a GET and mutates nothing).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { resolveParkedPopulation, summarizeParked } from '../../../lib/parked/resolver.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const getParkedRoute = HttpRouter.add(
  'GET',
  '/api/parked',
  httpHandler(Effect.gen(function* () {
    try {
      const rows = yield* Effect.promise(() => resolveParkedPopulation());
      return jsonResponse({ rows, summary: summarizeParked(rows) });
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  })),
);

export const parkedRouteLayer = Layer.mergeAll(getParkedRoute);

export default parkedRouteLayer;
