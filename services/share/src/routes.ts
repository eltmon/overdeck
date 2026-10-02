/**
 * Route table, request pipeline and JSON helpers for the share service (PRD PAN-658 "HTTP API").
 *
 * Order per request: match path → 404; match method → 405 with Allow; config gate → 503 for
 * everything but /healthz; 16 KiB body guard → 413; handler.
 * Every response is built by json() or withSecurityHeaders(), so each one carries
 * `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
 */
import type { CreateRoomResponse, RoomSnapshot, ShareScope } from '../../../packages/contracts/src/sharing.ts';
import { verifyIdentity } from './account.ts';
import { newHostToken, newShortCode, normalizeShortCode, sha256Hex } from './codes.ts';
import type { Config, Deps, Env, RoomInitBody, RoomStatusBody } from './env.ts';
import { HDR_HOST_TOKEN_HASH, INTERNAL, parseConfig, parseTurnConfig } from './env.ts';
import { endedPage, invitePage } from './pages.ts';

export const MAX_BODY_BYTES = 16 * 1024;

const COMMON_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers({ ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * Stamps the common headers onto a response a handler built itself (an HTML page, a 204).
 * A 101 WebSocket upgrade is returned untouched: its headers belong to the handshake.
 */
export function withSecurityHeaders(res: Response): Response {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [key, value] of Object.entries(COMMON_HEADERS)) out.headers.set(key, value);
  return out;
}

/** Per-request context handed to every handler. */
export interface RequestContext {
  env: Env;
  config: Config;
  deps: Deps;
  params: Record<string, string>;
}

export type Handler = (req: Request, rc: RequestContext) => Promise<Response>;

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
}

/** GET /healthz: liveness, whether PUBLIC_BASE_URL is set, and whether TURN is available; reveals no value. */
function healthz(env: Env): Response {
  return json({ ok: true, configured: parseConfig(env).ok, turn: parseTurnConfig(env) !== null });
}

/** The room's Durable Object stub; one object per short code. */
function roomStub(env: Env, shortCode: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(shortCode));
}

function roomFetch(env: Env, shortCode: string, path: string, init?: RequestInit): Promise<Response> {
  return roomStub(env, shortCode).fetch('https://room' + path, init);
}

/** Fresh codes tried after the first one collides with an existing room. */
export const CODE_RETRIES = 3;
export const MAX_CONVERSATION_ID_CHARS = 200;
/** C0 and C1 control characters, plus DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** A new scope object built from known keys only, or null when the request's scope is invalid. */
function parseScope(body: unknown): ShareScope | null {
  if (typeof body !== 'object' || body === null) return null;
  const scope = (body as { scope?: unknown }).scope;
  if (typeof scope !== 'object' || scope === null) return null;
  const { kind, conversationId } = scope as { kind?: unknown; conversationId?: unknown };
  if (kind !== 'conversation' || typeof conversationId !== 'string') return null;
  if (conversationId.length < 1 || conversationId.length > MAX_CONVERSATION_ID_CHARS) return null;
  if (CONTROL_CHARS.test(conversationId)) return null;
  return { kind, conversationId };
}

/** POST /v1/rooms: a device-authenticated host creates a room for one conversation. */
const createRoom: Handler = async (req, rc) => {
  const verified = await verifyIdentity(rc.env, req.headers.get('Authorization'));
  if (!verified.ok) return json({ error: verified.error }, verified.status);
  const dataOwner = verified.identity;

  if (rc.env.ROOM_CREATE_LIMIT) {
    const { success } = await rc.env.ROOM_CREATE_LIMIT.limit({ key: String(dataOwner.githubId) });
    if (!success) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const scope = parseScope(body);
  if (!scope) return json({ error: 'invalid_request' }, 400);

  const hostToken = newHostToken(rc.deps);
  const hostTokenHash = await sha256Hex(hostToken);
  for (let attempt = 0; attempt <= CODE_RETRIES; attempt++) {
    const shortCode = newShortCode(rc.deps);
    const init: RoomInitBody = { shortCode, scope, dataOwner, hostTokenHash, createdAt: rc.deps.now() };
    const res = await roomFetch(rc.env, shortCode, INTERNAL.init, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(init),
    });
    if (res.status === 409) continue;
    if (res.status !== 201) return json({ error: 'room_unavailable' }, 503);
    const snapshot = (await res.json()) as RoomSnapshot;
    const response: CreateRoomResponse = {
      shortCode,
      hostToken,
      joinUrl: `${rc.config.publicBaseUrl}/s/${shortCode}`,
      snapshot,
    };
    return json(response, 201);
  }
  return json({ error: 'code_space_exhausted' }, 503);
};

const HOST_BEARER_RE = /^Bearer (odh_[0-9a-f]{64})$/;

/** DELETE /v1/rooms/:code: the host token ends the room. Unknown, ended and wrong-token all answer 404. */
const deleteRoom: Handler = async (req, rc) => {
  const token = HOST_BEARER_RE.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return json({ error: 'invalid_token' }, 401);
  const shortCode = normalizeShortCode(rc.params['code'] ?? '');
  if (!shortCode) return json({ error: 'not_found' }, 404);
  const res = await roomFetch(rc.env, shortCode, INTERNAL.delete, {
    method: 'POST',
    headers: { [HDR_HOST_TOKEN_HASH]: await sha256Hex(token) },
  });
  if (res.status !== 204) return json({ error: 'not_found' }, 404);
  return new Response(null, { status: 204 });
};

/** GET /s/:code: the invite landing page. It never reveals room data. */
const landingPage: Handler = async (_req, rc) => {
  const shortCode = normalizeShortCode(rc.params['code'] ?? '');
  if (!shortCode) return endedPage();
  const res = await roomFetch(rc.env, shortCode, INTERNAL.status);
  if (res.status !== 200) return endedPage();
  const { status } = (await res.json()) as RoomStatusBody;
  return status === 'active' ? invitePage(shortCode) : endedPage();
};

const ROUTES: Route[] = [
  { method: 'GET', pattern: '/healthz', handler: async (_req, rc) => healthz(rc.env) },
  { method: 'POST', pattern: '/v1/rooms', handler: createRoom },
  { method: 'DELETE', pattern: '/v1/rooms/:code', handler: deleteRoom },
  { method: 'GET', pattern: '/s/:code', handler: landingPage },
];

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i] as string;
    const g = got[i] as string;
    if (w.startsWith(':')) {
      if (g === '') return null;
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null;
      }
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

function methodNotAllowed(allow: string[]): Response {
  return json({ error: 'method_not_allowed' }, 405, { Allow: allow.join(', ') });
}

export type BodyGuardResult = { ok: true; req: Request } | { ok: false; response: Response };

/**
 * Reads the request body with a running byte count and refuses anything over 16 KiB with 413.
 * Content-Length is not trusted; the stream is what counts. On success the body is handed back
 * inside a fresh Request so handlers can still call `json()`/`text()`.
 */
export async function guardBody(req: Request): Promise<BodyGuardResult> {
  if (req.body === null) return { ok: true, req };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, response: json({ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES }, 413) };
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, req: new Request(req.url, { method: req.method, headers: req.headers, body }) };
}

export async function handle(req: Request, env: Env, deps: Deps): Promise<Response> {
  const pathname = new URL(req.url).pathname;

  const candidates: Array<{ route: Route; params: Record<string, string> }> = [];
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, pathname);
    if (params) candidates.push({ route, params });
  }
  if (candidates.length === 0) return json({ error: 'not_found' }, 404);
  const matched = candidates.find((c) => c.route.method === req.method);
  if (!matched) return methodNotAllowed(candidates.map((c) => c.route.method));

  if (matched.route.pattern === '/healthz') return healthz(env);

  const parsed = parseConfig(env);
  if (!parsed.ok) return json({ error: 'not_configured', missing: parsed.missing }, 503);

  const guarded = await guardBody(req);
  if (!guarded.ok) return guarded.response;

  const rc: RequestContext = { env, config: parsed.config, deps, params: matched.params };
  try {
    return withSecurityHeaders(await matched.route.handler(guarded.req, rc));
  } catch (error) {
    console.error('share-service: unhandled error', pathname, error instanceof Error ? error.message : error);
    return json({ error: 'internal_error' }, 500);
  }
}
