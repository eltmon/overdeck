/**
 * PAN-4947 (PAN-4927 W-FUN1): rate limit and audit every public MCP request
 * that arrives through Tailscale Funnel.
 *
 * D-5: one global middleware covers all nine surfaces. It acts only on the
 * requests the gate admits through rule 0 for public MCP (a Funnel request,
 * the switch on, an exact public surface), so it is correct in either order
 * against `remoteRequestGateLayer`. Every other request passes untouched.
 * D-6: keys are `token:<tokenId>` (60/min) for a `POST /mcp` with an OAuth
 * token, `poll:<ip>` (60/min) for the authorize page's status poll, and
 * `ip:<ip>` (20/min) for everything else; the IP is the first
 * `x-forwarded-for` entry, else `unknown`.
 * D-7: fixed windows from a key's first request (`public-mcp-rate-limit.ts`).
 * D-8: one activity entry per request while the switch is on, failures
 * included (status 500). It never reads a request body and never logs a token,
 * a code or a header value; the only identifier is the OAuth client id.
 */
import { Effect, Exit } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { emitActivityEntry, type EmitActivityOptions } from '../../lib/activity-logger.js';
import { isPublicMcpEnabled, publicMcpSurface } from '../../lib/mcp/public-mcp.js';
import { jsonResponse } from './http-helpers.js';
import { createFixedWindowLimiter, type FixedWindowLimiter } from './public-mcp-rate-limit.js';
import { isTailscaleFunnelRequest, resolveDashboardCredential } from './routes/dashboard-auth.js';
import { getHeaderFromMap, type HeaderMap } from './routes/origin-validation.js';

const MCP_LIMIT = 60;
const POLL_LIMIT = 60;
const IP_LIMIT = 20;

export interface PublicMcpFunnelDeps {
  limiter: FixedWindowLimiter;
  audit: (entry: EmitActivityOptions) => void;
}

function clientIp(headers: HeaderMap): string {
  const first = getHeaderFromMap(headers, 'x-forwarded-for')?.split(',')[0]?.trim();
  return first ? first : 'unknown';
}

export function makePublicMcpFunnelLayer(deps: PublicMcpFunnelDeps) {
  return HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers = request.headers as HeaderMap;
        if (!isTailscaleFunnelRequest(headers) || !isPublicMcpEnabled()) return yield* httpEffect;
        const surface = publicMcpSurface(request.method, request.url);
        if (surface === null) return yield* httpEffect;

        const ip = clientIp(headers);
        const credential = surface === 'POST /mcp' ? resolveDashboardCredential(headers) : null;
        const oauthClientId = credential?.kind === 'token' ? credential.oauthClientId : undefined;
        const [key, limit] = credential?.kind === 'token' && oauthClientId
          ? [`token:${credential.tokenId}`, MCP_LIMIT]
          : surface === 'GET /oauth/mcp/authorize/status'
            ? [`poll:${ip}`, POLL_LIMIT]
            : [`ip:${ip}`, IP_LIMIT];
        const clientId = oauthClientId
          ?? (surface === 'GET /oauth/mcp/authorize' ? new URL(request.url, 'http://localhost').searchParams.get('client_id') : null)
          ?? null;
        const audit = (status: number) => deps.audit({
          source: 'dashboard',
          level: status === 429 ? 'warn' : 'info',
          message: `Public MCP ${surface} ${status}`,
          details: JSON.stringify({ clientId }),
        });

        const decision = deps.limiter.hit(key, limit);
        if (!decision.allowed) {
          audit(429);
          return jsonResponse({ error: 'rate_limited' }, {
            status: 429,
            headers: { 'Retry-After': String(decision.retryAfterSeconds), 'Cache-Control': 'no-store' },
          });
        }
        return yield* Effect.onExit(httpEffect, (exit) =>
          Effect.sync(() => audit(Exit.isSuccess(exit) ? exit.value.status : 500)));
      }),
    { global: true },
  );
}

export const publicMcpFunnelLayer = makePublicMcpFunnelLayer({
  limiter: createFixedWindowLimiter(),
  audit: emitActivityEntry,
});
