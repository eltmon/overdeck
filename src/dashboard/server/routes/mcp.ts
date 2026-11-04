/**
 * `/mcp` (PAN-4649 FR-8) — the Overdeck MCP server over streamable HTTP, in
 * stateless JSON mode: every `POST /mcp` gets a fresh MCP server and
 * transport, answers with one JSON body, and keeps no session (D-4649-2).
 * `GET` and `DELETE` answer 405 with `Allow: POST`.
 *
 * `/mcp` is outside `/api/` and `/events/`, so the remote request gate does
 * not see it; this handler checks the credential itself (D-4649-4), in order:
 * an untrusted present Origin → 403, no internal token configured → 503, no
 * credential → 401, a credential that is not `kind: 'token'` (the internal
 * token, the root session, a paired device) → 403, a token with `admin` → 403.
 * MCP is always fenced (D-21): it never runs with a root credential. The 401
 * carries `WWW-Authenticate` naming the OAuth protected-resource metadata when
 * the request's host is a trusted origin (PAN-4945). Over Tailscale Funnel
 * (PAN-4947) a token without `oauthClientId` gets 403.
 *
 * Each tool proxies a dashboard route over the loopback URL with the caller's
 * own Bearer token, so the route-scope table judges every tool call and a
 * revoked token fails its next request. The token travels only in the
 * `Authorization` header (NFR-4).
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getDashboardLoopbackApiUrl } from '../../../lib/config.js';
import { getInternalToken } from '../../../lib/internal-token.js';
import { createFetchDashboardApi, type DashboardApi } from '../../../lib/mcp/dashboard-api.js';
import { createOverdeckMcpServer, hasAgentId } from '../../../lib/mcp/server.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { credentialScopes, dashboardDeviceTokenFromHeaders, isTailscaleFunnelRequest, resolveDashboardCredential } from './dashboard-auth.js';
import { issuerFor } from './mcp-oauth.js';
import { getHeaderFromMap, validateOriginHeaders, type HeaderMap } from './origin-validation.js';

export interface McpRouteDeps {
  makeApi(token: string): DashboardApi;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const FENCED_ERROR = 'MCP needs an access token without admin scope; use Copy MCP URL in Settings → Anywhere';
const PUBLIC_OAUTH_ONLY = 'public MCP accepts only OAuth sign-ins';

function headersOf(request: HttpServerRequest.HttpServerRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers as HeaderMap)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return headers;
}

/** Serve one stateless MCP request: a fresh server and transport, closed after the response body is read. */
async function serveMcpRequest(
  deps: McpRouteDeps,
  token: string,
  scopes: readonly string[],
  isAgent: boolean,
  headers: Headers,
  body: string,
) {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createOverdeckMcpServer({ api: deps.makeApi(token), scopes, isAgent });
  try {
    await server.connect(transport);
    const webResponse = await transport.handleRequest(new Request('http://localhost/mcp', { method: 'POST', headers, body }));
    const text = await webResponse.text();
    const responseHeaders: Record<string, string> = { ...NO_STORE };
    webResponse.headers.forEach((value, name) => {
      if (name !== 'content-type' && name !== 'content-length') responseHeaders[name] = value;
    });
    return HttpServerResponse.text(text, {
      status: webResponse.status,
      contentType: webResponse.headers.get('content-type') ?? 'application/json',
      headers: responseHeaders,
    });
  } finally {
    await server.close();
  }
}

export function makeMcpRouteLayer(deps: McpRouteDeps) {
  const postMcpRoute = HttpRouter.add(
    'POST',
    '/mcp',
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const headers = request.headers as HeaderMap;
      // Only a present Origin is judged: MCP clients send none, and the
      // credential checks below refuse an unauthenticated request with 401.
      if (getHeaderFromMap(headers, 'origin') !== undefined && !validateOriginHeaders(headers, request.method).ok) {
        return jsonResponse({ error: 'Invalid origin' }, { status: 403, headers: NO_STORE });
      }
      if (!getInternalToken()) {
        return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503, headers: NO_STORE });
      }
      const credential = resolveDashboardCredential(headers);
      if (!credential) {
        // PAN-4945 (RFC 9728 §5.1): point an OAuth client at the protected-resource metadata.
        const issuer = issuerFor(request);
        const challenge: Record<string, string> = issuer ? { 'WWW-Authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"` } : {};
        return jsonResponse({ error: 'unauthorized' }, { status: 401, headers: { ...NO_STORE, ...challenge } });
      }
      const token = dashboardDeviceTokenFromHeaders(headers);
      if (credential.kind !== 'token' || !token || credentialScopes(credential).includes('admin')) {
        return jsonResponse({ error: FENCED_ERROR }, { status: 403, headers: NO_STORE });
      }
      // PAN-4947 FR-3: over Tailscale Funnel only an OAuth sign-in may use MCP.
      if (isTailscaleFunnelRequest(headers) && !credential.oauthClientId) {
        return jsonResponse({ error: PUBLIC_OAUTH_ONLY }, { status: 403, headers: NO_STORE });
      }
      const body = yield* request.text;
      return yield* Effect.promise(() => serveMcpRequest(deps, token, credential.scopes, hasAgentId(credential), headersOf(request), body));
    })),
  );

  const methodNotAllowed = Effect.succeed(
    jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { ...NO_STORE, Allow: 'POST' } }),
  );
  const getMcpRoute = HttpRouter.add('GET', '/mcp', methodNotAllowed);
  const deleteMcpRoute = HttpRouter.add('DELETE', '/mcp', methodNotAllowed);

  return Layer.mergeAll(postMcpRoute, getMcpRoute, deleteMcpRoute);
}

export const mcpRouteLayer = makeMcpRouteLayer({
  makeApi: (token) => createFetchDashboardApi({ baseUrl: getDashboardLoopbackApiUrl(), token }),
});
