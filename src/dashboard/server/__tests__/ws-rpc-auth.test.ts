import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { HttpServerRequest } from 'effect/unstable/http';

import { _resetInternalTokenCacheForTests } from '../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { rejectUnauthorizedRpcUpgrade } from '../ws-rpc.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

/** Minimal HttpServerRequest stand-in for the RPC upgrade gate (reads headers + method). */
function fakeRequest(headers: Record<string, string>): HttpServerRequest.HttpServerRequest {
  return { headers, method: 'GET' } as unknown as HttpServerRequest.HttpServerRequest;
}

describe('rejectUnauthorizedRpcUpgrade', () => {
  beforeEach(() => {
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    process.env.OVERDECK_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  afterEach(() => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
    _resetTrustedOriginsForTests();
  });

  it('rejects a trusted origin with no credential (401)', () => {
    const rejected = rejectUnauthorizedRpcUpgrade(fakeRequest({ origin: TRUSTED_ORIGIN }));
    expect(rejected).not.toBeNull();
    expect(rejected?.status).toBe(401);
  });

  it('accepts a trusted origin with a valid session cookie', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());
    const rejected = rejectUnauthorizedRpcUpgrade(fakeRequest({ origin: TRUSTED_ORIGIN, cookie }));
    expect(rejected).toBeNull();
  });

  it('rejects an untrusted origin (403)', () => {
    const rejected = rejectUnauthorizedRpcUpgrade(fakeRequest({ origin: 'https://evil.example' }));
    expect(rejected).not.toBeNull();
    expect(rejected?.status).toBe(403);
  });
});
