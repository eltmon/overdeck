import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { checkCodexAuthStatus } from '../../../lib/codex-auth.js';
import { bridgeCodexAuthToCliproxyAsync } from '../../../lib/cliproxy.js';
import { createSessionAsync, sessionExistsAsync, listSessionNamesAsync } from '../../../lib/tmux.js';

// ─── Re-auth session registry ──────────────────────────────────────────────────

interface ReauthSession {
  token: string;
  createdAt: number;
}

const reauthSessions = new Map<string, ReauthSession>();
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function generateReauthSession(): { sessionName: string; token: string } {
  const sessionName = `reauth-${randomUUID()}`;
  const token = randomUUID();
  reauthSessions.set(sessionName, { token, createdAt: Date.now() });
  return { sessionName, token };
}

function validateReauthToken(sessionName: string, token: string): boolean {
  const session = reauthSessions.get(sessionName);
  if (!session) return false;
  if (session.token !== token) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    reauthSessions.delete(sessionName);
    return false;
  }
  return true;
}

function cleanupExpiredReauthSessions(): void {
  const now = Date.now();
  for (const [name, session] of reauthSessions.entries()) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      reauthSessions.delete(name);
    }
  }
}

export function getReauthSessionToken(sessionName: string): string | undefined {
  const session = reauthSessions.get(sessionName);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    reauthSessions.delete(sessionName);
    return undefined;
  }
  return session.token;
}

export function invalidateReauthToken(sessionName: string): void {
  reauthSessions.delete(sessionName);
}

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

// ─── Route: POST /api/settings/codex-reauth ────────────────────────────────────

async function findExistingLiveReauthSession(): Promise<{ sessionName: string; token: string } | null> {
  cleanupExpiredReauthSessions();
  const sessions = await listSessionNamesAsync();
  for (const [name, session] of reauthSessions.entries()) {
    if (sessions.includes(name)) {
      return { sessionName: name, token: session.token };
    }
  }
  return null;
}

const postCodexReauthRoute = HttpRouter.add(
  'POST',
  '/api/settings/codex-reauth',
  httpHandler(
    Effect.gen(function* () {
      const existing = yield* Effect.promise(() => findExistingLiveReauthSession());
      if (existing) {
        return jsonResponse({
          sessionName: existing.sessionName,
          token: existing.token,
          headless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        });
      }

      const { sessionName, token } = generateReauthSession();

      const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
      const command = headless ? 'codex login --device-auth' : 'codex login';

      yield* Effect.promise(() =>
        createSessionAsync(sessionName, homedir(), command, {
          env: { PATH: process.env.PATH || '' },
        }),
      );

      return jsonResponse({ sessionName, token, headless });
    }),
  ),
);

// ─── Route: GET /api/settings/codex-reauth/status ──────────────────────────────

const getCodexReauthStatusRoute = HttpRouter.add(
  'GET',
  '/api/settings/codex-reauth/status',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const urlOpt = HttpServerRequest.toURL(request);
      const searchParams = Option.isSome(urlOpt)
        ? urlOpt.value.searchParams
        : new URLSearchParams();
      const sessionName = searchParams.get('session') ?? '';
      const token = searchParams.get('token') ?? '';

      if (!validateReauthToken(sessionName, token)) {
        return jsonResponse({ completed: false });
      }

      const exists = yield* Effect.promise(() => sessionExistsAsync(sessionName));
      if (exists) {
        return jsonResponse({ completed: false });
      }

      yield* Effect.promise(() => bridgeCodexAuthToCliproxyAsync());
      const authStatus = yield* Effect.promise(() => checkCodexAuthStatus());
      reauthSessions.delete(sessionName);
      return jsonResponse({ completed: true, authStatus });
    }),
  ),
);

export const codexAuthRouteLayer = Layer.mergeAll(
  getCodexAuthRoute,
  postCodexReauthRoute,
  getCodexReauthStatusRoute,
);
