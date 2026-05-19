import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';
import { getHeaderFromMap, getTrustedOrigins, normalizeOrigin, type HeaderMap } from './origin-validation.js';

export const DASHBOARD_SESSION_COOKIE = 'panopticon_session';
export const DASHBOARD_CSRF_HEADER = 'x-panopticon-csrf-token';

let browserSessionToken: string | undefined;
let browserCsrfToken: string | undefined;

export function _resetDashboardSessionTokenForTests(): void {
  browserSessionToken = undefined;
  browserCsrfToken = undefined;
}

function getDashboardSessionToken(): string {
  browserSessionToken ??= process.env['PANOPTICON_DASHBOARD_SESSION_TOKEN'] ?? randomBytes(32).toString('base64url');
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
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(getDashboardSessionToken())}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export function hasDashboardInternalTokenHeaders(headers: HeaderMap): boolean {
  const expected = getInternalToken();
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

  if (!hasTrustedExactOrigin(headers)) {
    return jsonResponse({ error: 'Invalid origin' }, { status: 403 });
  }
  if (!hasValidCsrfToken(headers)) {
    return jsonResponse({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  return null;
}

export function rejectUnauthorizedDashboardSessionMintRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalToken();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardInternalToken(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export function rejectUnauthorizedDashboardRequest(
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse | null {
  const expected = getInternalToken();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardAuth(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
