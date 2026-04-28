import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { checkCodexAuthStatus } from '../../../lib/codex-auth.js';

// ─── Route: GET /api/settings/codex-auth ───────────────────────────────────────

const getCodexAuthRoute = HttpRouter.add(
  'GET',
  '/api/settings/codex-auth',
  httpHandler(
    Effect.gen(function* () {
      const status = yield* Effect.promise(() => checkCodexAuthStatus());
      return jsonResponse(status);
    }),
  ),
);

export const codexAuthRouteLayer = Layer.mergeAll(
  getCodexAuthRoute,
);
