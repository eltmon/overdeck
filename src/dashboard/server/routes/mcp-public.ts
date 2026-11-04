/**
 * Operator routes for public MCP over Tailscale Funnel (PAN-4947 FR-6, D-9).
 *
 * - `GET /api/mcp/public` answers the switch, the Funnel on and off commands
 *   and the public `/mcp` URL (`null` without a `.ts.net` trusted address).
 * - `PUT /api/mcp/public` with `{ enabled: boolean }` saves the switch through
 *   `savePublicMcpEnabled` and answers the same body.
 *
 * The remote request gate keeps these `admin` (no `route-scopes.ts` row), and
 * each handler further admits only the internal token or the root session, the
 * same as `mcp-oauth-admin.ts`. No answer is cacheable.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  isPublicMcpEnabled,
  publicMcpFunnelCommands,
  publicMcpFunnelOffCommands,
} from '../../../lib/mcp/public-mcp.js';
import { savePublicMcpEnabled } from '../../../lib/mcp/public-mcp-write.js';
import { triggerDashboardPort, triggerFunnelBaseUrl } from '../../../lib/triggers/setup.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest, resolveRequestCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import { getTrustedOrigins } from './origin-validation.js';

export interface McpPublicRouteDeps {
  save: (enabled: boolean) => Promise<void>;
  isEnabled: () => boolean;
  port: () => number;
  trustedOrigins: () => readonly string[];
}

const ROOT_ONLY = 'only the internal token or the root session can change public MCP';
const BAD_BODY = 'body must be { enabled: boolean }';

function json(data: unknown, status = 200): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(jsonResponse(data, { status }), 'Cache-Control', 'no-store');
}

/** The gate's answer, then a 403 unless the request carries a root credential. */
function rejectRequest(request: HttpServerRequest.HttpServerRequest, mutation: boolean): HttpServerResponse.HttpServerResponse | null {
  const authError = mutation ? rejectUnsafeDashboardMutationRequest(request) : rejectUnauthorizedDashboardRequest(request);
  if (authError) return HttpServerResponse.setHeader(authError, 'Cache-Control', 'no-store');
  const kind = resolveRequestCredential(request)?.kind;
  return kind === 'internal-token' || kind === 'root-session' ? null : json({ error: ROOT_ONLY }, 403);
}

export function makeMcpPublicRouteLayer(deps: McpPublicRouteDeps) {
  const status = () => {
    const base = triggerFunnelBaseUrl(deps.trustedOrigins());
    return {
      enabled: deps.isEnabled(),
      funnelCommands: publicMcpFunnelCommands(deps.port()),
      funnelOffCommands: publicMcpFunnelOffCommands(),
      mcpUrl: base ? `${base}/mcp` : null,
    };
  };

  const getRoute = HttpRouter.add('GET', '/api/mcp/public', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, false);
    if (rejected) return rejected;
    return json(status());
  })));

  const putRoute = HttpRouter.add('PUT', '/api/mcp/public', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rejected = rejectRequest(request, true);
    if (rejected) return rejected;
    const text = yield* request.text;
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const enabled = body && typeof body === 'object' ? (body as { enabled?: unknown }).enabled : undefined;
    if (typeof enabled !== 'boolean') return json({ error: BAD_BODY }, 400);
    yield* Effect.promise(() => deps.save(enabled));
    return json(status());
  })));

  return Layer.mergeAll(getRoute, putRoute);
}

export const mcpPublicRouteLayer = makeMcpPublicRouteLayer({
  save: savePublicMcpEnabled,
  isEnabled: isPublicMcpEnabled,
  port: triggerDashboardPort,
  trustedOrigins: getTrustedOrigins,
});
