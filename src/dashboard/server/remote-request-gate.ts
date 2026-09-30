/**
 * The remote request gate (PAN-3762 FR-15, D-3762-8).
 *
 * The server binds 0.0.0.0, and many routes check only Origin, so a LAN peer
 * could call them with no credential. This one global middleware closes that:
 * every `/api/*` and `/events/*` request needs a dashboard credential unless it
 * comes from a trusted local caller or is on the unauthenticated allowlist.
 * Rules, in order:
 *
 *   1. The path is not under `/api/` or `/events/` (the static SPA): pass.
 *   2. `METHOD path` is on REMOTE_GATE_ALLOWLIST: pass.
 *   3. The request carries a dashboard credential: pass.
 *   4. The request is a trusted local caller: pass. A loopback peer (the local
 *      browser, or the host-local Traefik) is local, except that with
 *      `dashboard.require_token_mint` a loopback peer carrying a proxy
 *      forwarding header is remote.
 *   5. Otherwise: 401 `{ "error": "unauthorized" }`.
 *
 * `GET /events/stream` also accepts its own `OVERDECK_EVENTS_TOKEN` bearer
 * (when that variable is set), so remote SSE consumers such as an external
 * TTS sidecar keep working (PAN-2351 D-3: existing schemes keep working).
 *
 * Routes keep their own checks (Origin, CSRF, internal-token-only routes); the
 * gate only decides whether an uncredentialed request may reach them at all.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { readRemoteAccessConfig } from '../../lib/remote-access/config.js';
import { jsonResponse } from './http-helpers.js';
import { hasProxyForwardingHeader, isLoopbackPeer, resolveDashboardCredential } from './routes/dashboard-auth.js';
import { getHeaderFromMap, type HeaderMap } from './routes/origin-validation.js';

/** `METHOD path` pairs that answer without a credential. */
export const REMOTE_GATE_ALLOWLIST: ReadonlySet<string> = new Set([
  'GET /api/health',
  'GET /api/environment',
  'OPTIONS /api/dashboard/session',
  'POST /api/dashboard/session',
  'POST /api/pairing/exchange',
  // HMAC-verified by its own route.
  'POST /api/webhooks/github',
]);

/**
 * The request path as the gate judges it. The router matches loosely (a
 * request for `//api/x` reaches `/api/x`), so the gate normalizes before it
 * decides: it drops the query, takes the path of an absolute-form target,
 * decodes percent escapes, collapses repeated slashes and resolves `.` and
 * `..` segments. An undecodable path returns `null`, which the gate rejects.
 */
export function gatePathname(url: string): string | null {
  let path = url.split(/[?#]/, 1)[0] ?? '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split(/[/\\]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const trailing = /[/\\]$/.test(path) && segments.length > 0 ? '/' : '';
  return `/${segments.join('/')}${trailing}`;
}

function isGatedPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === '/api' || lower === '/events' || lower.startsWith('/api/') || lower.startsWith('/events/');
}

function hasEventsStreamToken(headers: HeaderMap): boolean {
  const expected = process.env['OVERDECK_EVENTS_TOKEN'];
  if (!expected) return false;
  const [scheme, token] = (getHeaderFromMap(headers, 'authorization') ?? '').split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(token), digest(expected));
}

/** True when the request is a trusted local caller under the current config. */
export function isTrustedLocalRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  if (!isLoopbackPeer(request)) return false;
  return !(readRemoteAccessConfig().requireTokenMint && hasProxyForwardingHeader(request.headers as HeaderMap));
}

/** The gate decision for one request: `null` lets it through. */
export function remoteGateRejection(request: HttpServerRequest.HttpServerRequest): { status: 401 } | null {
  const pathname = gatePathname(request.url);
  if (pathname === null) return { status: 401 };
  if (!isGatedPath(pathname)) return null;
  if (REMOTE_GATE_ALLOWLIST.has(`${request.method} ${pathname}`)) return null;
  const headers = request.headers as HeaderMap;
  if (resolveDashboardCredential(headers) !== null) return null;
  if (pathname === '/events/stream' && hasEventsStreamToken(headers)) return null;
  if (isTrustedLocalRequest(request)) return null;
  return { status: 401 };
}

export const remoteRequestGateLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (remoteGateRejection(request)) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
      return yield* httpEffect;
    }),
  { global: true },
);
