import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { homedir } from 'node:os';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { checkCodexAuthStatus } from '../../../lib/codex-auth.js';
import { createSessionAsync, sessionExistsAsync } from '../../../lib/tmux.js';

// ─── Route: GET /api/settings/codex-auth ───────────────────────────────────────

const REAUTH_SESSION_NAME = 'codex-reauth';

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

// ─── Route: POST /api/settings/codex-reauth ────────────────────────────────────

const postCodexReauthRoute = HttpRouter.add(
  'POST',
  '/api/settings/codex-reauth',
  httpHandler(
    Effect.gen(function* () {
      const exists = yield* Effect.promise(() => sessionExistsAsync(REAUTH_SESSION_NAME));
      if (exists) {
        return jsonResponse({ sessionName: REAUTH_SESSION_NAME, headless: false });
      }

      const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
      const command = headless ? 'codex login --device-auth' : 'codex login';

      yield* Effect.promise(() =>
        createSessionAsync(REAUTH_SESSION_NAME, homedir(), command, {
          env: { PATH: process.env.PATH || '' },
        }),
      );

      return jsonResponse({ sessionName: REAUTH_SESSION_NAME, headless });
    }),
  ),
);

export const codexAuthRouteLayer = Layer.mergeAll(
  getCodexAuthRoute,
  postCodexReauthRoute,
);
