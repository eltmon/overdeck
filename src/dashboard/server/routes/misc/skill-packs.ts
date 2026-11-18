/**
 * Known skill packs for the dashboard (PAN-5540).
 *
 *   GET /api/skills/packs/available
 *
 * Returns `{ packs, groups }` from `listAvailablePacks`: every known pack and pack group, what is
 * added, and which the dashboard may add. The route has no ROUTE_SCOPES row, so a remote credential
 * needs `admin` (the fail-closed default).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';

import { listAvailablePacks } from '../../../../lib/skill-packs/known.js';
import { jsonResponse } from '../../http-helpers.js';

function errorResponse(error: unknown) {
  console.error('[skill-packs] request failed:', error);
  return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

const getAvailableRoute = HttpRouter.add(
  'GET',
  '/api/skills/packs/available',
  Effect.promise(async () => {
    try {
      return jsonResponse(await listAvailablePacks());
    } catch (error) {
      return errorResponse(error);
    }
  }),
);

export const skillPacksRouteLayer = Layer.mergeAll(getAvailableRoute);
