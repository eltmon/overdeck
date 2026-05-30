import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { _resetInternalTokenCacheForTests } from '../../../../lib/internal-token.js';
import {
  DASHBOARD_SESSION_COOKIE,
  _resetDashboardSessionTokenForTests,
  dashboardSessionCookieHeader,
  hasDashboardAuthHeaders,
} from '../dashboard-auth.js';

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
});
