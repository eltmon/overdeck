import { randomBytes, timingSafeEqual } from 'node:crypto';

import { HttpServerRequest } from 'effect/unstable/http';

import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { jsonResponse } from '../http-helpers.js';

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
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const direct = headers[name];
  if (Array.isArray(direct)) return direct[0];
  if (direct) return direct;

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName) continue;
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
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

export function hasDashboardInternalToken(request: HttpServerRequest.HttpServerRequest): boolean {
  const expected = getInternalToken();
  if (!expected) return false;

  const internalHeader = getHeader(request, INTERNAL_TOKEN_HEADER);
  if (constantTimeTokenEqual(internalHeader, expected)) return true;

  const authorization = getHeader(request, 'authorization');
  if (authorization) {
    const [scheme, token] = authorization.split(/\s+/);
    if (scheme?.toLowerCase() === 'bearer' && constantTimeTokenEqual(token, expected)) return true;
  }

  return false;
}

export function hasDashboardAuth(request: HttpServerRequest.HttpServerRequest): boolean {
  return hasDashboardInternalToken(request) || constantTimeTokenEqual(cookieValue(getHeader(request, 'cookie'), DASHBOARD_SESSION_COOKIE), getDashboardSessionToken());
}

export function rejectUnauthorizedDashboardSessionMintRequest(
  request: HttpServerRequest.HttpServerRequest,
): Response | null {
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
): Response | null {
  const expected = getInternalToken();
  if (!expected) {
    return jsonResponse({ error: 'dashboard session token not configured' }, { status: 503 });
  }
  if (!hasDashboardAuth(request)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
