/**
 * Terminal routes (PAN-1545 / PAN-1561) — ad-hoc tmux sessions for the
 * terminal drawer and the standalone terminal view.
 *
 *   POST   /api/terminals          — create a fresh tmux session, returns { sessionName, cwd }
 *   DELETE /api/terminals/:name    — kill a session
 *
 * Each "terminal" in the T3-style drawer is one of these tmux sessions; the
 * frontend then attaches via the existing raw `/ws/terminal?session=` socket
 * (XTerminal). When PAN-1536 moves terminal streaming onto PanRpcGroup with
 * t3code's `terminal.*` contracts, this create/kill pair is the seam that gets
 * folded into that RPC surface.
 */

import { existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { createSession, killSession } from '../../../lib/tmux.js';
import { getDefaultCwd } from '../../../lib/default-cwd.js';
import { validateOrigin } from './origin-validation.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
});

/** Origin + dashboard-session guard, mirroring other mutating routes. */
function rejectUnauthorized(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
  return rejectUnauthorizedDashboardRequest(request);
}

/** Resolve a safe working directory: a caller cwd only if it's an existing dir,
 * otherwise the dashboard default (~/Projects or $HOME). */
function resolveCwd(raw: unknown): string {
  if (typeof raw === 'string' && raw.startsWith('/')) {
    try {
      if (existsSync(raw) && statSync(raw).isDirectory()) return raw;
    } catch {
      /* fall through to default */
    }
  }
  return getDefaultCwd();
}

function generateTerminalSessionName(): string {
  return `term-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

const postTerminalRoute = HttpRouter.add(
  'POST',
  '/api/terminals',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = rejectUnauthorized(request);
      if (authError) return authError;

      const body = yield* readJsonBody;
      const cwd = resolveCwd(body.cwd);
      const sessionName = generateTerminalSessionName();

      yield* createSession(sessionName, cwd, undefined, {
        env: { PATH: process.env.PATH || '' },
      });

      return jsonResponse({ sessionName, cwd });
    }),
  ),
);

const deleteTerminalRoute = HttpRouter.add(
  'DELETE',
  '/api/terminals/:name',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authError = rejectUnauthorized(request);
      if (authError) return authError;

      const params = yield* HttpRouter.params;
      const name = params.name;
      if (!name) return jsonResponse({ error: 'session name required' }, { status: 400 });

      yield* killSession(name);
      return jsonResponse({ ok: true });
    }),
  ),
);

export const terminalsRouteLayer = Layer.mergeAll(postTerminalRoute, deleteTerminalRoute);
