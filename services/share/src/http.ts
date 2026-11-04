/**
 * Response helpers and the handler types shared by routes.ts and web-auth.ts.
 *
 * Every response is built by json() or withSecurityHeaders(), so each one carries
 * `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Kept apart from routes.ts so
 * route modules can import them without an import cycle through the route table.
 */
import type { Config, Deps, Env } from './env.ts';

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
