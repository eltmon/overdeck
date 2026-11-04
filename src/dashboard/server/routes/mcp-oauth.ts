/**
 * The OAuth 2.1 authorization server for `/mcp` (PAN-4945, PAN-4927 D-15):
 * discovery metadata, dynamic client registration, the authorize page with
 * its status poll, and the token and revocation endpoints.
 *
 * These paths are outside `/api/` and `/events/`, so the remote request gate
 * does not judge them; every handler checks its own input, and none needs a
 * credential. A Funnel request still reaches none of them (the gate's Funnel
 * rule answers 404) until W-FUN1 opens it.
 *
 * Every metadata URL is built from `issuerFor(request)`, which picks a trusted
 * origin matching the request's host (D-2) and never echoes a raw `Host`, so
 * an unknown host gets 400. The protocol logic lives in `lib/mcp/oauth-*`.
 *
 * The authorize page shows values anyone can send (client name, redirect
 * host), so it is rendered escaped and served with a per-response nonce CSP,
 * no-store, no-referrer and no framing (D-11). A request that names an
 * unknown client or an unregistered redirect URI gets an error page, never a
 * redirect.
 */
import { randomBytes } from 'node:crypto';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import {
  authorizationServerMetadata,
  authorizePageCsp,
  oauthErrorBody,
  protectedResourceMetadata,
  renderAuthorizePage,
  renderOAuthErrorPage,
  resolveIssuer,
} from '../../../lib/mcp/oauth-flow.js';
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

const PAGE_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

function htmlResponse(html: string, status: number, headers: Record<string, string>) {
  return HttpServerResponse.text(html, { status, contentType: 'text/html; charset=utf-8', headers: { ...PAGE_HEADERS, ...headers } });
}

function queryOf(request: HttpServerRequest.HttpServerRequest): URLSearchParams {
  return new URL(request.url, 'http://local').searchParams;
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

  const authorizeRoute = HttpRouter.add('GET', '/oauth/mcp/authorize', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const outcome = yield* Effect.promise(() => deps.service.authorize(queryOf(request)));
    if (outcome.kind === 'redirect') {
      return HttpServerResponse.empty({ status: 302, headers: { Location: outcome.location, 'Cache-Control': 'no-store' } });
    }
    const nonce = randomBytes(16).toString('base64');
    if (outcome.kind === 'error-page') {
      return htmlResponse(renderOAuthErrorPage(outcome.message), 400, { 'Content-Security-Policy': authorizePageCsp(nonce) });
    }
    const html = renderAuthorizePage({ nonce, requestId: outcome.requestId, clientName: outcome.clientName, redirectHost: outcome.redirectHost, approvalCode: outcome.approvalCode });
    return htmlResponse(html, 200, { 'Content-Security-Policy': authorizePageCsp(nonce) });
  })));

  const authorizeStatusRoute = HttpRouter.add('GET', '/oauth/mcp/authorize/status', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return jsonResponse(deps.service.approvalStatus(queryOf(request).get('request') ?? ''), { headers: NO_STORE });
  })));

  const tokenRoute = HttpRouter.add('POST', '/oauth/mcp/token', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
    if (!hasMediaType(request, 'application/x-www-form-urlencoded')) {
      return jsonResponse(oauthErrorBody('invalid_request', 'the body must be application/x-www-form-urlencoded'), { status: 400, headers });
    }
    const form = new URLSearchParams(yield* request.text);
    const grantType = form.get('grant_type');
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      return jsonResponse(oauthErrorBody('unsupported_grant_type'), { status: 400, headers });
    }
    const result = yield* Effect.promise(() => (grantType === 'authorization_code' ? deps.service.exchangeCode(form) : deps.service.refresh(form)));
    return jsonResponse(result.body, { status: result.ok ? 200 : result.status, headers });
  })));

  const revokeRoute = HttpRouter.add('POST', '/oauth/mcp/revoke', httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // RFC 7009 §2.2: answer 200 whether or not the token was known.
    if (hasMediaType(request, 'application/x-www-form-urlencoded')) {
      const form = new URLSearchParams(yield* request.text);
      yield* Effect.promise(() => deps.service.revokeToken(form.get('token') ?? ''));
    }
    return jsonResponse({}, { headers: NO_STORE });
  })));

  return Layer.mergeAll(
    HttpRouter.add('GET', '/.well-known/oauth-protected-resource', metadataHandler(protectedResourceMetadata)),
    HttpRouter.add('GET', '/.well-known/oauth-protected-resource/mcp', metadataHandler(protectedResourceMetadata)),
    HttpRouter.add('GET', '/.well-known/oauth-authorization-server', metadataHandler(authorizationServerMetadata)),
    registerRoute,
    authorizeRoute,
    authorizeStatusRoute,
    tokenRoute,
    revokeRoute,
  );
}

export const mcpOAuthRouteLayer = makeMcpOAuthRouteLayer({ service: mcpOAuthService, issuerFor });
