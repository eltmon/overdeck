/**
 * The remote request gate (PAN-3762 FR-15, D-3762-8).
 *
 * The server binds 0.0.0.0, and many routes check only Origin, so a LAN peer
 * could call them with no credential. This one global middleware closes that:
 * every `/api/*` and `/events/*` request needs a dashboard credential unless it
 * comes from a trusted local caller or is on the unauthenticated allowlist.
 * Rules, in order:
 *
 *   0. A Tailscale Funnel request (header `Tailscale-Funnel-Request`, which
 *      tailscaled always overwrites) reaches only `POST /hooks/*`, the trigger
 *      delivery route; every other method and path gets 404, credential or
 *      not (PAN-4648 FR-9). Funnel proxies to 127.0.0.1, so without this rule
 *      a public request would look like the local operator. With
 *      `mcp.public.enabled` on (PAN-4947), it also reaches exactly the nine
 *      public MCP surfaces in `PUBLIC_MCP_SURFACES` (`src/lib/mcp/public-mcp.ts`),
 *      matched on the raw path.
 *  0b. With `OVERDECK_PUBLIC_LINK_ONLY=1` (a linked Fly machine, PAN-4652
 *      FR-5), a request that is neither a secure-channel request nor a
 *      loopback peer without a proxy forwarding header gets 404 on every
 *      path, the static SPA included. The `/ws/link` upgrade is handled
 *      before this gate, so home still links in.
 *   1. The path is not under `/api/` or `/events/` (the static SPA): pass.
 *   2. `METHOD path` is on REMOTE_GATE_ALLOWLIST: pass.
 *   3. The request carries a dashboard credential: pass when its scopes satisfy
 *      the route-scope table (`route-scopes.ts`; unlisted routes need `admin`),
 *      else 403 `{ "error": "insufficient_scope", "missingScope": "<scope>" }`.
 *      A registry credential is judged by its scopes, never by the peer
 *      (PAN-2351 D-7): a narrow token from 127.0.0.1 still gets 403.
 *   4. The request is a trusted local caller: pass. A loopback peer (the local
 *      browser, or the host-local Traefik) is local, except that with
 *      `dashboard.require_token_mint` a loopback peer carrying a proxy
 *      forwarding header is remote, and a Funnel request is never local.
 *   5. Otherwise: 401 `{ "error": "unauthorized" }`.
 *
 * Secure channels (PAN-4645 WI-4): a request whose socket is a `ChannelSocket`
 * never counts as a trusted local caller. A pairing-mode channel may reach
 * exactly `GET /api/environment`, `POST /api/machines/exchange` and (PAN-4835)
 * `POST /api/phones/exchange`, and nothing else; those two exchange routes are
 * reachable only that way, so a plain socket gets 401 there whatever it
 * presents. A link-mode channel is judged by its `machine` or `phone` credential.
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

import { scopeSatisfies, type AccessTokenScope } from '../../lib/access-tokens.js';
import { isPublicMcpEnabled, publicMcpSurface } from '../../lib/mcp/public-mcp.js';
import { readRemoteAccessConfig } from '../../lib/remote-access/config.js';
import { type ChannelMarker, channelOfRequest } from './channel-peer.js';
import { jsonResponse } from './http-helpers.js';
import { AGENT_FENCED_MESSAGE, linkActorFence } from './link-fence.js';
import { gatePathname, requiredScopeFor } from './route-scopes.js';
import {
  credentialScopes,
  hasProxyForwardingHeader,
  isLoopbackPeer,
  isTailscaleFunnelRequest,
  resolveDashboardCredential,
} from './routes/dashboard-auth.js';
import { getHeaderFromMap, type HeaderMap } from './routes/origin-validation.js';

export { gatePathname } from './route-scopes.js';

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

/** True when this server answers only secure channels and local callers (rule 0b). */
export function publicLinkOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['OVERDECK_PUBLIC_LINK_ONLY'] === '1';
}

/** True when the request is a trusted local caller under the current config. */
export function isTrustedLocalRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  if (!isLoopbackPeer(request)) return false;
  const headers = request.headers as HeaderMap;
  if (isTailscaleFunnelRequest(headers)) return false;
  return !(readRemoteAccessConfig().requireTokenMint && hasProxyForwardingHeader(headers));
}

export type RemoteGateRejection =
  | { status: 401 }
  | { status: 403; missingScope: AccessTokenScope }
  | { status: 403; code: 'agent-fenced' }
  | { status: 404 };

/** `METHOD path` pairs a pairing-mode channel may reach without a credential (PAN-4645, PAN-4835, PAN-4927). */
export const PAIRING_CHANNEL_ALLOWLIST: ReadonlySet<string> = new Set([
  'GET /api/environment',
  'POST /api/machines/exchange',
  'POST /api/phones/exchange',
  'POST /api/connectors/exchange',
]);
/** `METHOD path` pairs an approval-mode channel may reach without a credential (PAN-2356 D-2356-9). */
export const APPROVAL_CHANNEL_ALLOWLIST: ReadonlySet<string> = new Set(['GET /api/environment', 'POST /api/machines/approval-exchange']);
const MACHINES_EXCHANGE = 'POST /api/machines/exchange';
const APPROVAL_EXCHANGE = 'POST /api/machines/approval-exchange';
const PHONES_EXCHANGE = 'POST /api/phones/exchange';
const CONNECTORS_EXCHANGE = 'POST /api/connectors/exchange';

/** The gate decision for one request: `null` lets it through. */
export function remoteGateRejection(
  request: HttpServerRequest.HttpServerRequest,
  channel: ChannelMarker | null = channelOfRequest(request),
): RemoteGateRejection | null {
  const pathname = gatePathname(request.url);
  if (pathname === null) return { status: 401 };
  if (isTailscaleFunnelRequest(request.headers as HeaderMap)) {
    if (request.method === 'POST' && pathname.startsWith('/hooks/')) return null;
    // PAN-4927 D-16 (PAN-4947): the public MCP surface, exact raw path, only while the operator has it on.
    return isPublicMcpEnabled() && publicMcpSurface(request.method, request.url) !== null ? null : { status: 404 };
  }
  if (publicLinkOnly() && channel === null
    && !(isLoopbackPeer(request) && !hasProxyForwardingHeader(request.headers as HeaderMap))) {
    return { status: 404 };
  }
  if (!isGatedPath(pathname)) return null;
  const surface = `${request.method} ${pathname}`;
  if (channel?.mode === 'pairing') return PAIRING_CHANNEL_ALLOWLIST.has(surface) ? null : { status: 401 };
  if (channel?.mode === 'approval') return APPROVAL_CHANNEL_ALLOWLIST.has(surface) ? null : { status: 401 };
  if (surface === MACHINES_EXCHANGE || surface === APPROVAL_EXCHANGE || surface === PHONES_EXCHANGE || surface === CONNECTORS_EXCHANGE) return { status: 401 };
  if (REMOTE_GATE_ALLOWLIST.has(surface)) return null;
  const headers = request.headers as HeaderMap;
  const credential = resolveDashboardCredential(headers, channel);
  if (credential !== null) {
    // PAN-4650 D-4650-7: an agent on a linked machine reads conversations but never changes them.
    if (linkActorFence(credential, request.method, pathname)) return { status: 403, code: 'agent-fenced' };
    // PAN-2351 D-7: a registry credential is judged by its scopes, never by the peer.
    const required = requiredScopeFor(request.method, pathname);
    return scopeSatisfies(credentialScopes(credential), required) ? null : { status: 403, missingScope: required };
  }
  // A channel request is never a trusted local caller (D-4645-10).
  if (channel !== null) return { status: 401 };
  if (pathname === '/events/stream' && hasEventsStreamToken(headers)) return null;
  if (isTrustedLocalRequest(request)) return null;
  return { status: 401 };
}

export const remoteRequestGateLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const rejection = remoteGateRejection(request);
      if (rejection?.status === 403 && 'code' in rejection) {
        return jsonResponse({ error: AGENT_FENCED_MESSAGE, code: rejection.code }, { status: 403 });
      }
      if (rejection?.status === 403) {
        return jsonResponse({ error: 'insufficient_scope', missingScope: rejection.missingScope }, { status: 403 });
      }
      if (rejection?.status === 404) return jsonResponse({ error: 'not found' }, { status: 404 });
      if (rejection) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
      return yield* httpEffect;
    }),
  { global: true },
);
