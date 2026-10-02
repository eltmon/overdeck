/**
 * Route table, request pipeline and JSON helpers for the share service (PRD PAN-658 "HTTP API").
 *
 * Order per request: match path → 404; match method → 405 with Allow; config gate → 503 for
 * everything but /healthz; 16 KiB body guard → 413; handler.
 * Every response is built by json() or withSecurityHeaders(), so each one carries
 * `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
 */
import type { Config, Deps, Env } from './env.ts';
import { parseConfig, parseTurnConfig } from './env.ts';

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

const ROUTES: Route[] = [{ method: 'GET', pattern: '/healthz', handler: async (_req, rc) => healthz(rc.env) }];

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
