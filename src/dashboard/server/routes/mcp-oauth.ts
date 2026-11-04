/**
 * The OAuth 2.1 authorization server for `/mcp` (PAN-4945, PAN-4927 D-15):
 * discovery metadata and dynamic client registration.
 *
 * These paths are outside `/api/` and `/events/`, so the remote request gate
 * does not judge them; every handler checks its own input, and none needs a
 * credential. A Funnel request still reaches none of them (the gate's Funnel
 * rule answers 404) until W-FUN1 opens it.
 *
 * Every metadata URL is built from `issuerFor(request)`, which picks a trusted
 * origin matching the request's host (D-2) and never echoes a raw `Host`, so
 * an unknown host gets 400. The protocol logic lives in `lib/mcp/oauth-*`.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { authorizationServerMetadata, oauthErrorBody, protectedResourceMetadata, resolveIssuer } from '../../../lib/mcp/oauth-flow.js';
import { mcpOAuthService, type McpOAuthService } from '../../../lib/mcp/oauth-service.js';
import { triggerFunnelBaseUrl } from '../../../lib/triggers/setup.js';
import { jsonResponse } from '../http-helpers.js';
import { isTailscaleFunnelRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import { getHeaderFromMap, getTrustedOrigins, type HeaderMap } from './origin-validation.js';

export interface McpOAuthRouteDeps {
  service: McpOAuthService;
  issuerFor(request: HttpServerRequest.HttpServerRequest): string | null;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_REGISTRATION_BYTES = 16 * 1024;

/** The issuer for this request (D-2), or null when its host is not a trusted origin. */
export function issuerFor(request: HttpServerRequest.HttpServerRequest): string | null {
  const headers = request.headers as HeaderMap;
  const trustedOrigins = getTrustedOrigins();
  return resolveIssuer({
    funnel: isTailscaleFunnelRequest(headers),
    hostHeaders: [getHeaderFromMap(headers, 'host'), getHeaderFromMap(headers, 'x-forwarded-host')],
    trustedOrigins,
    funnelBase: triggerFunnelBaseUrl(trustedOrigins),
  });
}

/** True when the request's media type (before any `;` parameters) is `type`. */
export function hasMediaType(request: HttpServerRequest.HttpServerRequest, type: string): boolean {
  const value = getHeaderFromMap(request.headers as HeaderMap, 'content-type');
  return value?.split(';')[0]?.trim().toLowerCase() === type;
}

function unknownHost() {
  return jsonResponse({ error: 'unknown host' }, { status: 400, headers: NO_STORE });
}

export function makeMcpOAuthRouteLayer(deps: McpOAuthRouteDeps) {
  const metadataHandler = (body: (issuer: string) => Record<string, unknown>) =>
    httpHandler(Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const issuer = deps.issuerFor(request);
      return issuer === null ? unknownHost() : jsonResponse(body(issuer), { headers: NO_STORE });
    }));

  const registerRoute = HttpRouter.add('POST', '/oauth/mcp/register', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const invalid = (description: string) =>
      jsonResponse(oauthErrorBody('invalid_client_metadata', description), { status: 400, headers: NO_STORE });
    if (!hasMediaType(request, 'application/json')) return invalid('the body must be application/json');
    const text = yield* request.text;
    if (Buffer.byteLength(text) > MAX_REGISTRATION_BYTES) return invalid('the body must be at most 16 KiB');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return invalid('the body must be valid JSON');
    }
    const result = yield* Effect.promise(() => deps.service.registerClient(body));
    return result.ok
      ? jsonResponse(result.body, { status: 201, headers: NO_STORE })
      : jsonResponse(result.body, { status: result.status, headers: NO_STORE });
  })));

  return Layer.mergeAll(
    HttpRouter.add('GET', '/.well-known/oauth-protected-resource', metadataHandler(protectedResourceMetadata)),
    HttpRouter.add('GET', '/.well-known/oauth-protected-resource/mcp', metadataHandler(protectedResourceMetadata)),
    HttpRouter.add('GET', '/.well-known/oauth-authorization-server', metadataHandler(authorizationServerMetadata)),
    registerRoute,
  );
}

export const mcpOAuthRouteLayer = makeMcpOAuthRouteLayer({ service: mcpOAuthService, issuerFor });
