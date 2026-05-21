import { randomBytes, timingSafeEqual } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';
import { getHeaderFromMap, type HeaderMap } from './origin-validation.js';

export const DASHBOARD_SESSION_COOKIE = 'panopticon_session';

let browserSessionToken: string | undefined;

export function _resetDashboardSessionTokenForTests(): void {
  browserSessionToken = undefined;
}

function getDashboardSessionToken(): string {
  browserSessionToken ??= process.env['PANOPTICON_DASHBOARD_SESSION_TOKEN'] ?? randomBytes(32).toString('base64url');
  return browserSessionToken;
}

function getHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  return getHeaderFromMap(request.headers as HeaderMap, name);
}

function constantTimeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
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
