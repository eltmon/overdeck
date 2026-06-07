import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getInternalTokenSync, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';
import { getHeaderFromMap, getTrustedOrigins, normalizeOrigin, type HeaderMap } from './origin-validation.js';

export const DASHBOARD_SESSION_COOKIE = 'panopticon_session';
export const DASHBOARD_CSRF_HEADER = 'x-panopticon-csrf-token';
// Session cookie lifetime. Without Max-Age the cookie was a *session* cookie that
// died when the browser fully closed — so a reopened tab on a trusted origin had
// no cookie, its mint 401'd, and every mutation failed with "CSRF token
// unavailable" until the operator re-bootstrapped via the one-time URL token.
// A 30-day rolling expiry means the operator bootstraps once per browser.
const DASHBOARD_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

let browserSessionToken: string | undefined;
let browserCsrfToken: string | undefined;

export function _resetDashboardSessionTokenForTests(): void {
  browserSessionToken = undefined;
  browserCsrfToken = undefined;
}

function getDashboardSessionToken(): string {
  if (browserSessionToken) return browserSessionToken;
  const override = process.env['PANOPTICON_DASHBOARD_SESSION_TOKEN'];
  if (override) {
    browserSessionToken = override;
    return browserSessionToken;
  }
  // Derive a stable session token from the persisted internal token so the
  // browser's session cookie survives dashboard restarts. Without this the
  // token was random per-process, so every restart invalidated open tabs'
  // cookies — and a plain refresh could no longer re-mint, since the one-time
  // bootstrap hash token is already consumed on first load. Falls back to a
  // random token only when no internal token is configured, in which case the
  // auth gate already 503s before the session token is ever consulted.
  const internal = getInternalTokenSync();
  browserSessionToken = internal
    ? createHmac('sha256', internal).update('panopticon-dashboard-session-v1').digest('base64url')
    : randomBytes(32).toString('base64url');
  return browserSessionToken;
}

export function dashboardCsrfToken(): string {
  browserCsrfToken ??= process.env['PANOPTICON_DASHBOARD_CSRF_TOKEN'] ?? randomBytes(32).toString('base64url');
  return browserCsrfToken;
}

function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  return getHeaderFromMap(request.headers as HeaderMap, name);
}

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function dashboardSessionCookieHeader(options: { secure?: boolean } = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(getDashboardSessionToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DASHBOARD_SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function hasDashboardInternalTokenHeaders(headers: HeaderMap): boolean {
  const expected = getInternalTokenSync();
  if (!expected) return false;

  const internalHeader = getHeaderFromMap(headers, INTERNAL_TOKEN_HEADER);
  if (constantTimeTokenEqual(internalHeader, expected)) return true;

  const authorization = getHeaderFromMap(headers, 'authorization');
  if (authorization) {
    const [scheme, token] = authorization.split(/\s+/);
    if (scheme?.toLowerCase() === 'bearer' && constantTimeTokenEqual(token, expected)) return true;
  }

  return false;
}

export function hasDashboardInternalToken(request: HttpServerRequest.HttpServerRequest): boolean {
  return hasDashboardInternalTokenHeaders(request.headers as HeaderMap);
}

export function hasDashboardAuthHeaders(headers: HeaderMap): boolean {
  return hasDashboardInternalTokenHeaders(headers) || constantTimeTokenEqual(cookieValue(getHeaderFromMap(headers, 'cookie'), DASHBOARD_SESSION_COOKIE), getDashboardSessionToken());
}

export function hasDashboardAuth(request: HttpServerRequest.HttpServerRequest): boolean {
  return hasDashboardAuthHeaders(request.headers as HeaderMap);
}

function isJsonContentType(headers: HeaderMap): boolean {
  const contentType = getHeaderFromMap(headers, 'content-type');
  if (!contentType) return false;
  const [mime] = contentType.toLowerCase().split(';');
  return mime.trim() === 'application/json';
}

function hasTrustedExactOrigin(headers: HeaderMap): boolean {
  const origin = getHeaderFromMap(headers, 'origin');
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return !!normalized && getTrustedOrigins().includes(normalized);
}

function hasValidCsrfToken(headers: HeaderMap): boolean {
  return constantTimeTokenEqual(getHeaderFromMap(headers, DASHBOARD_CSRF_HEADER), dashboardCsrfToken());
}

export function rejectUnsafeDashboardMutationRequest(
  request: HttpServerRequest.HttpServerRequest,
): Response | null {
  const authError = rejectUnauthorizedDashboardRequest(request);
  if (authError) return authError;

  const headers = request.headers as HeaderMap;
  if (!isJsonContentType(headers)) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, { status: 400 });
  }

  if (hasDashboardInternalToken(request)) return null;

  const origin = getHeaderFromMap(headers, 'origin');
  if (origin && !hasTrustedExactOrigin(headers)) {
    return jsonResponse({ error: 'Invalid origin' }, { status: 403 });
  }
  if (!hasValidCsrfToken(headers)) {
    return jsonResponse({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  return null;
}

/**
 * A request whose TCP peer is loopback originated from this machine — either the
 * local browser hitting the dashboard directly, or via the host-local Traefik
 * (127.0.0.1) that fronts pan.localhost. We trust it to mint a session.
 *
 * This is the auto-bootstrap that removes the manual one-time #panopticon_token
 * step: any browser on pan.localhost gets a session with no user action. It is
 * NOT a security downgrade for the LAN — the raw API ports bind 0.0.0.0, but a
 * direct LAN hit to :3010 has a non-loopback peer and is rejected here. We read
 * ONLY the real TCP peer (request.remoteAddress), never X-Forwarded-For, which a
 * caller could spoof.
 */
function isLoopbackPeer(request: HttpServerRequest.HttpServerRequest): boolean {
  const remoteAddress = request.remoteAddress as Option.Option<string> | string | undefined;
  const addr = typeof remoteAddress === 'string'
    ? remoteAddress
    : remoteAddress
      ? Option.getOrElse(remoteAddress, () => '')
      : '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function rejectUnauthorizedDashboardSessionMintRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalTokenSync();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardInternalToken(request) && !isLoopbackPeer(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export function rejectUnauthorizedDashboardRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalTokenSync();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardAuth(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
