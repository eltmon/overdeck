import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { checkCodexAuthStatus } from '../../../lib/codex-auth.js';
import { bridgeCodexAuthToCliproxyAsync } from '../../../lib/cliproxy.js';
import { createSessionAsync, sessionExistsAsync, listSessionNamesAsync } from '../../../lib/tmux.js';
import { validateOrigin } from './origin-validation.js';

// ─── Re-auth session registry ──────────────────────────────────────────────────

interface ReauthSession {
  terminalToken: string;
  statusToken: string;
  createdAt: number;
}

const reauthSessions = new Map<string, ReauthSession>();
const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  return text ? JSON.parse(text) as Record<string, unknown> : {};
});

function rejectInvalidOrigin(request: HttpServerRequest.HttpServerRequest): ReturnType<typeof jsonResponse> | null {
  const originCheck = validateOrigin(request);
  if (!originCheck.ok) {
    return jsonResponse({ error: originCheck.error }, { status: 403 });
  }
  return null;
}

function generateReauthSession(): { sessionName: string; terminalToken: string; statusToken: string } {
  const sessionName = `reauth-${randomUUID()}`;
  const terminalToken = randomUUID();
  const statusToken = randomUUID();
  reauthSessions.set(sessionName, { terminalToken, statusToken, createdAt: Date.now() });
  return { sessionName, terminalToken, statusToken };
}

function getLiveReauthSession(sessionName: string): ReauthSession | undefined {
  const session = reauthSessions.get(sessionName);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    reauthSessions.delete(sessionName);
    return undefined;
  }
  return session;
}

function validateReauthStatusToken(sessionName: string, token: string): boolean {
  const session = getLiveReauthSession(sessionName);
  return !!session && session.statusToken === token;
}

function cleanupExpiredReauthSessions(): void {
  const now = Date.now();
  for (const [name, session] of reauthSessions.entries()) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      reauthSessions.delete(name);
    }
  }
}

export function validateReauthTerminalToken(sessionName: string, token: string | undefined): boolean {
  const session = getLiveReauthSession(sessionName);
  return !!session && !!token && session.terminalToken === token;
}

function buildTerminalCookie(sessionName: string, terminalToken: string): string {
  const value = encodeURIComponent(`${sessionName}:${terminalToken}`);
  return `pan_codex_reauth=${value}; HttpOnly; SameSite=Strict; Path=/ws/terminal; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`;
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

async function hasExistingLiveReauthSession(): Promise<boolean> {
  cleanupExpiredReauthSessions();
  const sessions = await listSessionNamesAsync();
  return [...reauthSessions.keys()].some((name) => sessions.includes(name));
}

const postCodexReauthRoute = HttpRouter.add(
  'POST',
  '/api/settings/codex-reauth',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originError = rejectInvalidOrigin(request);
      if (originError) return originError;

      const existing = yield* Effect.promise(() => hasExistingLiveReauthSession());
      if (existing) {
        return jsonResponse({
          error: 'A Codex re-authentication session is already running.',
        }, { status: 409 });
      }

      const { sessionName, terminalToken, statusToken } = generateReauthSession();

      const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
      const command = headless ? 'codex login --device-auth' : 'codex login';

      yield* Effect.promise(() =>
        createSessionAsync(sessionName, homedir(), command, {
          env: { PATH: process.env.PATH || '' },
        }),
      );

      return jsonResponse(
        { sessionName, statusToken, headless },
        { headers: { 'Set-Cookie': buildTerminalCookie(sessionName, terminalToken) } },
      );
    }),
  ),
);

// ─── Route: POST /api/settings/codex-reauth/status ─────────────────────────────

const postCodexReauthStatusRoute = HttpRouter.add(
  'POST',
  '/api/settings/codex-reauth/status',
  httpHandler(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originError = rejectInvalidOrigin(request);
      if (originError) return originError;

      const body = yield* readJsonBody;
      const sessionName = typeof body.session === 'string' ? body.session : '';
      const token = typeof body.token === 'string' ? body.token : '';

      if (!validateReauthStatusToken(sessionName, token)) {
        return jsonResponse({ completed: false });
      }

      const exists = yield* Effect.promise(() => sessionExistsAsync(sessionName));
      if (exists) {
        return jsonResponse({ completed: false });
      }

      yield* Effect.promise(() => bridgeCodexAuthToCliproxyAsync());
      const authStatus = yield* Effect.promise(() => checkCodexAuthStatus());
      if (authStatus.status !== 'valid') {
        return jsonResponse({
          completed: true,
          success: false,
          authStatus,
          error: authStatus.message || `Codex authentication is ${authStatus.status}`,
        });
      }

      reauthSessions.delete(sessionName);
      return jsonResponse({ completed: true, success: true, authStatus });
    }),
  ),
);

export const codexAuthRouteLayer = Layer.mergeAll(
  getCodexAuthRoute,
  postCodexReauthRoute,
  postCodexReauthStatusRoute,
);
