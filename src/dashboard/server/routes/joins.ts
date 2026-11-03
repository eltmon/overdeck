/**
 * Shared Sessions viewer routes — Effect HttpRouter.Layer (PRD PAN-4475 WI-5).
 *
 * POST   /api/joins                    → 201 JoinView | 200 JoinView (live) | 400 invalid_code | 412 not_signed_in | 500
 * GET    /api/joins/:code              → 200 JoinView | 404 join_not_found
 * GET    /api/joins/:code/events       → 200 text/event-stream | 404 join_not_found
 * POST   /api/joins/:code/signal       → 202 { ok: true } | 400 invalid_signal | 404 | 409 join_not_admitted
 * POST   /api/joins/:code/ice-servers  → 200 { iceServers } | 404 | 409 join_not_admitted
 * DELETE /api/joins/:code              → 204 | 404 join_not_found
 * GET    /api/share-probe              → 200 { overdeck: true, v: 1 } (CORS for the share origin only)
 * OPTIONS /api/share-probe             → 204 (CORS + Private Network Access for the share origin only)
 *
 * The join manager (`services/share-join.ts`) owns the join sockets; the device token never
 * appears in a response or an event (NFR-1). The join intent is a same-origin, CSRF-protected POST
 * sent after the user clicks Join (D-1). Events reach the one subscriber as server-sent events
 * (D-2, D-4). These stay behind the remote request gate at the default `admin` scope, and every
 * response is `Cache-Control: no-store`.
 *
 * The probe (D-16) lets the share landing page find a running Overdeck on this computer. It calls no
 * dashboard auth function, because a cross-origin fetch carries no cookie; the remote request gate
 * still admits only a loopback peer, and it is deliberately not in `REMOTE_GATE_ALLOWLIST`, so a
 * LAN host cannot learn that Overdeck runs here. CORS headers go only to the configured share
 * origin.
 */
import type { JoinEvent, SignalData } from '@overdeck/contracts';
import { Effect, Layer, Stream } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { normalizeShareCode, parseJoinTarget } from '../../../lib/sharing/share-code.js';
import { readShareUrl, shareOrigin, type ShareUrlResult } from '../../../lib/sharing/share-service.js';
import { jsonResponse } from '../http-helpers.js';
import { getJoinManager } from '../services/share-join.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';

export { parseJoinTarget };

type Answer = { status: number; json?: unknown };

export const JOIN_SSE_KEEPALIVE_MS = 15_000;
const MAX_SDP_LENGTH = 32_768;
const MAX_CANDIDATE_LENGTH = 2_048;

const JOIN_NOT_FOUND: Answer = { status: 404, json: { error: 'join_not_found' } };

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

function respond(answer: Answer): HttpServerResponse.HttpServerResponse {
  if (answer.json === undefined) return noStore(HttpServerResponse.empty({ status: answer.status }));
  return noStore(jsonResponse(answer.json, { status: answer.status }));
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.text.pipe(Effect.map(parseJsonObject), Effect.orElseSucceed(() => null));

/** Rebuilds a browser signal from its known keys only; the viewer never sends an offer. */
export function parseSignalBody(body: Record<string, unknown> | null): SignalData | null {
  if (!body) return null;
  let sdp: SignalData['sdp'];
  let candidate: SignalData['candidate'];
  if (body.sdp !== undefined) {
    const raw = body.sdp as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null || raw.type !== 'answer') return null;
    if (typeof raw.sdp !== 'string' || raw.sdp.length > MAX_SDP_LENGTH) return null;
    sdp = { type: 'answer', sdp: raw.sdp };
  }
  if (body.candidate !== undefined) {
    const raw = body.candidate as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null) return null;
    if (typeof raw.candidate !== 'string' || raw.candidate.length > MAX_CANDIDATE_LENGTH) return null;
    const { sdpMid, sdpMLineIndex } = raw;
    if (sdpMid !== undefined && sdpMid !== null && typeof sdpMid !== 'string') return null;
    if (sdpMLineIndex !== undefined && sdpMLineIndex !== null
      && (typeof sdpMLineIndex !== 'number' || !Number.isSafeInteger(sdpMLineIndex) || sdpMLineIndex < 0)) return null;
    candidate = {
      candidate: raw.candidate,
      ...(sdpMid !== undefined ? { sdpMid: sdpMid as string | null } : {}),
      ...(sdpMLineIndex !== undefined ? { sdpMLineIndex: sdpMLineIndex as number | null } : {}),
    };
  }
  if (!sdp && !candidate) return null;
  return { ...(sdp ? { sdp } : {}), ...(candidate ? { candidate } : {}) };
}

/** The share origin when `origin` is exactly it; null otherwise (no CORS header is sent). */
export function probeCorsOrigin(origin: string | undefined, shareUrl: ShareUrlResult): string | null {
  return origin !== undefined && 'url' in shareUrl && origin === shareOrigin(shareUrl.url) ? origin : null;
}

function requestHeader(request: HttpServerRequest.HttpServerRequest, name: string): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

/** One server-sent event; the SSE `event:` name is the event's `type`. */
export function formatJoinEvent(event: JoinEvent): string {
  const payload = event.type === 'state' ? event.view : event.type === 'signal' ? event.data : {};
  return `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function createJoinFromBody(body: Record<string, unknown> | null): Promise<Answer> {
  const code = parseJoinTarget(body?.code);
  if (!code) return { status: 400, json: { error: 'invalid_code' } };
  const outcome = await getJoinManager().join(code);
  if (outcome.kind === 'error') return { status: outcome.status, json: outcome.body };
  return { status: outcome.kind === 'created' ? 201 : 200, json: outcome.view };
}

export function getJoinByCode(rawCode: string): Answer {
  const code = normalizeShareCode(rawCode);
  const view = code ? getJoinManager().get(code) : null;
  return view ? { status: 200, json: view } : JOIN_NOT_FOUND;
}

export function signalJoinFromBody(rawCode: string, body: Record<string, unknown> | null): Answer {
  const data = parseSignalBody(body);
  if (!data) return { status: 400, json: { error: 'invalid_signal' } };
  const code = normalizeShareCode(rawCode);
  if (!code) return JOIN_NOT_FOUND;
  const result = getJoinManager().signal(code, data);
  if (result === 'not_found') return JOIN_NOT_FOUND;
  if (result === 'not_admitted') return { status: 409, json: { error: 'join_not_admitted' } };
  return { status: 202, json: { ok: true } };
}

export async function joinIceServers(rawCode: string): Promise<Answer> {
  const code = normalizeShareCode(rawCode);
  if (!code) return JOIN_NOT_FOUND;
  const result = await getJoinManager().iceServers(code);
  if (result.ok) return { status: 200, json: { iceServers: result.iceServers } };
  return result.reason === 'not_found' ? JOIN_NOT_FOUND : { status: 409, json: { error: 'join_not_admitted' } };
}

export function leaveJoinByCode(rawCode: string): Answer {
  const code = normalizeShareCode(rawCode);
  if (!code || getJoinManager().leave(code) === 'not_found') return JOIN_NOT_FOUND;
  return { status: 204 };
}

/** The event stream for one join, or null when no join exists. Cancel unsubscribes (D-4). */
export function joinEventStream(code: string): ReadableStream<Uint8Array> | null {
  const manager = getJoinManager();
  if (!manager.get(code)) return null;
  const encoder = new TextEncoder();
  let stop: (() => void) | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let keepalive: NodeJS.Timeout | null = null;
      let unsubscribe: (() => void) | null = null;
      const end = () => {
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
        unsubscribe?.();
        unsubscribe = null;
      };
      const enqueue = (chunk: string): boolean => {
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          end();
          return false;
        }
      };
      unsubscribe = manager.subscribe(code, (event) => {
        if (!enqueue(formatJoinEvent(event))) return;
        if (event.type === 'replaced') {
          // The manager already dropped this subscriber; end the stream.
          unsubscribe = null;
          end();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
      if (!unsubscribe) {
        controller.close();
        return;
      }
      keepalive = setInterval(() => enqueue(': keepalive\n\n'), JOIN_SSE_KEEPALIVE_MS);
      keepalive.unref?.();
      stop = end;
    },
    cancel() {
      stop?.();
      stop = null;
    },
  });
}

const createJoinRoute = HttpRouter.add(
  'POST',
  '/api/joins',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const body = yield* readBody(request);
    return respond(yield* Effect.promise(() => createJoinFromBody(body)));
  }),
);

const getJoinRoute = HttpRouter.add(
  'GET',
  '/api/joins/:code',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    return respond(getJoinByCode((yield* HttpRouter.params)['code'] ?? ''));
  }),
);

const joinEventsRoute = HttpRouter.add(
  'GET',
  '/api/joins/:code/events',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const code = normalizeShareCode((yield* HttpRouter.params)['code'] ?? '');
    const events = code ? joinEventStream(code) : null;
    if (!events) return respond(JOIN_NOT_FOUND);
    const body = Stream.fromReadableStream<Uint8Array, unknown>({ evaluate: () => events, onError: (error) => error });
    return HttpServerResponse.stream(body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  }),
);

const signalJoinRoute = HttpRouter.add(
  'POST',
  '/api/joins/:code/signal',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const code = (yield* HttpRouter.params)['code'] ?? '';
    const body = yield* readBody(request);
    return respond(signalJoinFromBody(code, body));
  }),
);

const joinIceServersRoute = HttpRouter.add(
  'POST',
  '/api/joins/:code/ice-servers',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const code = (yield* HttpRouter.params)['code'] ?? '';
    return respond(yield* Effect.promise(() => joinIceServers(code)));
  }),
);

const leaveJoinRoute = HttpRouter.add(
  'DELETE',
  '/api/joins/:code',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    return respond(leaveJoinByCode((yield* HttpRouter.params)['code'] ?? ''));
  }),
);

const shareProbeRoute = HttpRouter.add(
  'GET',
  '/api/share-probe',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const shareUrl = yield* Effect.promise(() => readShareUrl());
    let response = HttpServerResponse.setHeader(respond({ status: 200, json: { overdeck: true, v: 1 } }), 'Vary', 'Origin');
    const origin = probeCorsOrigin(requestHeader(request, 'origin'), shareUrl);
    if (origin) response = HttpServerResponse.setHeader(response, 'Access-Control-Allow-Origin', origin);
    return response;
  }),
);

const shareProbePreflightRoute = HttpRouter.add(
  'OPTIONS',
  '/api/share-probe',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const shareUrl = yield* Effect.promise(() => readShareUrl());
    let response = HttpServerResponse.setHeader(respond({ status: 204 }), 'Vary', 'Origin');
    const origin = probeCorsOrigin(requestHeader(request, 'origin'), shareUrl);
    if (origin) {
      response = HttpServerResponse.setHeaders(response, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Private-Network': 'true',
      });
    }
    return response;
  }),
);

export const joinsRouteLayer = Layer.mergeAll(
  createJoinRoute,
  getJoinRoute,
  joinEventsRoute,
  signalJoinRoute,
  joinIceServersRoute,
  leaveJoinRoute,
  shareProbeRoute,
  shareProbePreflightRoute,
);
