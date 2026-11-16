/**
 * PAN-5342: safe shutdown — the drain's HTTP surface.
 *
 * - `GET /api/shutdown` (`read:state`): `{ shutdown }`, the live drain snapshot
 *   or null.
 * - `GET /api/shutdown/preview` (`read:state`): what a drain would stop now —
 *   agent and conversation counts, how many are mid-turn, the server-side
 *   writers, and the `pan reload`/`pan restart` holder that would refuse it.
 * - `POST /api/shutdown` (`admin`): start a drain. Body
 *   `{ deadlineSeconds?: 10..3600 (default 120), reboot?: boolean, force?: boolean }`.
 *   202, or 409 `{ error, code }` with `already-running` or `restart-in-progress` (D-11).
 * - `POST /api/shutdown/cancel` (`admin`): end the drain; 409 `complete` once
 *   the final stage has started, 409 `not-running` when no drain runs.
 * - `POST /api/shutdown/force-stop` (`admin`): body `{ id }`; stop that pending
 *   session now; 404 when it is not pending.
 * - `POST /api/shutdown/force-all` (`admin`): stop every pending session at the
 *   next tick; 409 `not-running` when no drain runs.
 *
 * Every POST checks the request origin and answers 403 on failure. A request
 * that carries a header-borne credential (the internal token `pan shutdown`
 * sends, an access token, a phone or a connector) skips the check, because a
 * cross-site page cannot send those headers (the PAN-2351 FR-9 rule).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import {
  cancelShutdown,
  forceAll,
  forceStopSession,
  getShutdownSnapshot,
  startShutdown,
} from '../services/shutdown/drain-service.js';
import { getShutdownPreview } from '../services/shutdown/preview.js';
import { resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

const HEADER_BORNE_CREDENTIALS = new Set(['internal-token', 'token', 'phone', 'connector']);

const SHUTDOWN_DEFAULT_DEADLINE_SECONDS = 120;
const SHUTDOWN_MIN_DEADLINE_SECONDS = 10;
const SHUTDOWN_MAX_DEADLINE_SECONDS = 3600;

interface StartShutdownBody {
  deadlineSeconds: number;
  reboot: boolean;
  force: boolean;
}

/** Validate the `POST /api/shutdown` body; a string is the 400 error text. */
function parseStartShutdownBody(body: unknown): StartShutdownBody | string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'Body must be a JSON object';
  const raw = body as Record<string, unknown>;
  const deadlineSeconds = raw['deadlineSeconds'] ?? SHUTDOWN_DEFAULT_DEADLINE_SECONDS;
  if (
    typeof deadlineSeconds !== 'number'
    || !Number.isFinite(deadlineSeconds)
    || deadlineSeconds < SHUTDOWN_MIN_DEADLINE_SECONDS
    || deadlineSeconds > SHUTDOWN_MAX_DEADLINE_SECONDS
  ) {
    return `deadlineSeconds must be a number from ${SHUTDOWN_MIN_DEADLINE_SECONDS} to ${SHUTDOWN_MAX_DEADLINE_SECONDS}`;
  }
  const reboot = raw['reboot'] ?? false;
  if (typeof reboot !== 'boolean') return 'reboot must be a boolean';
  const force = raw['force'] ?? false;
  if (typeof force !== 'boolean') return 'force must be a boolean';
  return { deadlineSeconds, reboot, force };
}

/** The request body as JSON; an empty body reads as `{}`, malformed JSON as undefined. */
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  if (!text.trim()) return {} as unknown;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
});

const forbiddenOrigin = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const credentialKind = resolveRequestCredential(request)?.kind;
  if (credentialKind && HEADER_BORNE_CREDENTIALS.has(credentialKind)) return null;
  const originCheck = validateOrigin(request);
  return originCheck.ok ? null : jsonResponse({ error: originCheck.error }, { status: 403 });
});

const getShutdownRoute = HttpRouter.add(
  'GET',
  '/api/shutdown',
  httpHandler(Effect.sync(() => jsonResponse({ shutdown: getShutdownSnapshot() }))),
);

const getShutdownPreviewRoute = HttpRouter.add(
  'GET',
  '/api/shutdown/preview',
  httpHandler(Effect.promise(async () => jsonResponse(await getShutdownPreview()))),
);

const startShutdownRoute = HttpRouter.add(
  'POST',
  '/api/shutdown',
  httpHandler(Effect.gen(function* () {
    const forbidden = yield* forbiddenOrigin;
    if (forbidden) return forbidden;
    const body = yield* readJsonBody;
    if (body === undefined) return jsonResponse({ error: 'Body must be valid JSON' }, { status: 400 });
    const parsed = parseStartShutdownBody(body);
    if (typeof parsed === 'string') return jsonResponse({ error: parsed }, { status: 400 });
    const result = yield* Effect.promise(() => startShutdown(parsed));
    if (result.started) return jsonResponse({ shutdown: result.snapshot }, { status: 202 });
    if (result.reason === 'restart-in-progress') {
      return jsonResponse({
        error: `A pan reload or pan restart is in progress (pid ${result.pid}). Wait for it to finish, then shut down.`,
        code: 'restart-in-progress',
      }, { status: 409 });
    }
    return jsonResponse({
      error: 'A shutdown is already running. Follow it with `pan shutdown --status`, or cancel it with `pan shutdown --cancel`.',
      code: 'already-running',
    }, { status: 409 });
  })),
);

const cancelShutdownRoute = HttpRouter.add(
  'POST',
  '/api/shutdown/cancel',
  httpHandler(Effect.gen(function* () {
    const forbidden = yield* forbiddenOrigin;
    if (forbidden) return forbidden;
    const result = yield* Effect.promise(() => cancelShutdown());
    if (result === 'cancelled') return jsonResponse({ cancelled: true });
    if (result === 'not-running') {
      return jsonResponse({ error: 'No shutdown is running.', code: 'not-running' }, { status: 409 });
    }
    return jsonResponse({
      error: 'The shutdown is complete and can no longer be cancelled.',
      code: 'complete',
    }, { status: 409 });
  })),
);

const forceStopRoute = HttpRouter.add(
  'POST',
  '/api/shutdown/force-stop',
  httpHandler(Effect.gen(function* () {
    const forbidden = yield* forbiddenOrigin;
    if (forbidden) return forbidden;
    const body = yield* readJsonBody;
    const id = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['id'] : undefined;
    if (typeof id !== 'string' || id.trim() === '') {
      return jsonResponse({ error: 'Body must be { id: string }' }, { status: 400 });
    }
    const stopped = yield* Effect.promise(() => forceStopSession(id));
    if (stopped) return jsonResponse({ forced: true, id });
    return jsonResponse({ error: `${id} is not pending in the shutdown` }, { status: 404 });
  })),
);

const forceAllRoute = HttpRouter.add(
  'POST',
  '/api/shutdown/force-all',
  httpHandler(Effect.gen(function* () {
    const forbidden = yield* forbiddenOrigin;
    if (forbidden) return forbidden;
    const forced = yield* Effect.promise(() => forceAll());
    if (forced) return jsonResponse({ forced: true });
    return jsonResponse({ error: 'No shutdown is running', code: 'not-running' }, { status: 409 });
  })),
);

export const shutdownRouteLayer = Layer.mergeAll(
  getShutdownRoute,
  getShutdownPreviewRoute,
  startShutdownRoute,
  cancelShutdownRoute,
  forceStopRoute,
  forceAllRoute,
);
