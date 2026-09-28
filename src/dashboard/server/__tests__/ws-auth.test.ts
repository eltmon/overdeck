import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { _resetDashboardSessionTokenForTests, dashboardSessionCookieHeader } from '../routes/dashboard-auth.js';
import { _resetTrustedOriginsForTests } from '../routes/origin-validation.js';
import { authorizeDashboardUpgrade } from '../ws-auth.js';

const TRUSTED_ORIGIN = 'http://localhost:3011';

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('authorizeDashboardUpgrade', () => {
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
    const result = authorizeDashboardUpgrade({ origin: TRUSTED_ORIGIN }, 'GET');
    expect(result).toEqual({ ok: false, status: 401, message: 'Unauthorized' });
  });

  it('rejects an untrusted origin even with a valid cookie (403)', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());
    const result = authorizeDashboardUpgrade({ origin: 'https://evil.example', cookie }, 'GET');
    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(403);
  });

  it('accepts a trusted origin with a valid session cookie', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());
    const result = authorizeDashboardUpgrade({ origin: TRUSTED_ORIGIN, cookie }, 'GET');
    expect(result).toEqual({ ok: true });
  });

  it('accepts no origin with the internal token header', () => {
    const result = authorizeDashboardUpgrade({ [INTERNAL_TOKEN_HEADER]: 'stable-internal-token' }, 'GET');
    expect(result).toEqual({ ok: true });
  });

  it('accepts no origin with an Authorization Bearer internal token', () => {
    const result = authorizeDashboardUpgrade({ authorization: 'Bearer stable-internal-token' }, 'GET');
    expect(result).toEqual({ ok: true });
  });

  it('rejects no origin with no credential (401)', () => {
    const result = authorizeDashboardUpgrade({}, 'GET');
    expect(result).toEqual({ ok: false, status: 401, message: 'Unauthorized' });
  });

  it('rejects with 503 when no internal token is configured', () => {
    delete process.env.OVERDECK_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
    const result = authorizeDashboardUpgrade({ origin: TRUSTED_ORIGIN }, 'GET');
    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(503);
  });

  it('rejects a cookie minted under a different internal token (401)', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());

    process.env.OVERDECK_INTERNAL_TOKEN = 'a-different-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();

    const result = authorizeDashboardUpgrade({ origin: TRUSTED_ORIGIN, cookie }, 'GET');
    expect(result).toEqual({ ok: false, status: 401, message: 'Unauthorized' });
  });
});
