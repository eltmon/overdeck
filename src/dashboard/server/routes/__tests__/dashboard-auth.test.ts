import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Option } from 'effect';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import {
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardSessionCookieHeader,
  hasDashboardAuthHeaders,
  rejectUnauthorizedDashboardSessionMintRequest,
} from '../dashboard-auth.js';

/** Minimal HttpServerRequest stand-in for the mint auth gate (reads headers + remoteAddress). */
function fakeRequest(opts: { remoteAddress?: string; headers?: Record<string, string> }) {
  return {
    headers: opts.headers ?? {},
    remoteAddress: opts.remoteAddress ? Option.some(opts.remoteAddress) : Option.none(),
  } as unknown as Parameters<typeof rejectUnauthorizedDashboardSessionMintRequest>[0];
}

/** Extract the `name=value` pair from a Set-Cookie header for use as a request cookie. */
function requestCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('dashboard session token persistence', () => {
  beforeEach(() => {
    delete process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN;
    process.env.PANOPTICON_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  afterEach(() => {
    delete process.env.PANOPTICON_INTERNAL_TOKEN;
    delete process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN;
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();
  });

  it('keeps a previously-minted session cookie valid across a restart (token regen)', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());
    expect(cookie.startsWith(`${DASHBOARD_SESSION_COOKIE}=`)).toBe(true);

    // Simulate a dashboard restart: the in-process session token is cleared and
    // re-derived. Because it is derived from the persisted internal token, the
    // cookie minted before the restart must still authenticate afterwards.
    _resetDashboardSessionTokenForTests();

    expect(hasDashboardAuthHeaders({ cookie })).toBe(true);
  });

  it('honors PANOPTICON_DASHBOARD_SESSION_TOKEN override over internal-token derivation', () => {
    process.env.PANOPTICON_DASHBOARD_SESSION_TOKEN = 'explicit-override-token';
    _resetDashboardSessionTokenForTests();

    const cookie = requestCookie(dashboardSessionCookieHeader());
    expect(cookie).toBe(`${DASHBOARD_SESSION_COOKIE}=explicit-override-token`);
    expect(hasDashboardAuthHeaders({ cookie })).toBe(true);
  });

  it('invalidates a session cookie when the internal token rotates', () => {
    const cookie = requestCookie(dashboardSessionCookieHeader());

    process.env.PANOPTICON_INTERNAL_TOKEN = 'rotated-internal-token';
    _resetInternalTokenCacheForTests();
    _resetDashboardSessionTokenForTests();

    expect(hasDashboardAuthHeaders({ cookie })).toBe(false);
  });

  it('issues a durable (Max-Age) session cookie so it survives a browser close', () => {
    expect(dashboardSessionCookieHeader()).toMatch(/Max-Age=\d+/);
  });
});

describe('dashboard session mint auth gate', () => {
  beforeEach(() => {
    process.env.PANOPTICON_INTERNAL_TOKEN = 'stable-internal-token';
    _resetInternalTokenCacheForTests();
  });
  afterEach(() => {
    delete process.env.PANOPTICON_INTERNAL_TOKEN;
    _resetInternalTokenCacheForTests();
  });

  it('auto-mints for a loopback peer with no token or cookie (zero-step bootstrap)', () => {
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(rejectUnauthorizedDashboardSessionMintRequest(fakeRequest({ remoteAddress: addr }))).toBeNull();
    }
  });

  it('rejects a mint from a non-loopback peer without a token (LAN cannot bootstrap)', () => {
    expect(rejectUnauthorizedDashboardSessionMintRequest(fakeRequest({ remoteAddress: '192.168.1.50' }))).not.toBeNull();
  });

  it('mints for the internal token even from a non-loopback peer (CLI / cross-process)', () => {
    const req = fakeRequest({ remoteAddress: '192.168.1.50', headers: { [INTERNAL_TOKEN_HEADER]: 'stable-internal-token' } });
    expect(rejectUnauthorizedDashboardSessionMintRequest(req)).toBeNull();
  });
});
