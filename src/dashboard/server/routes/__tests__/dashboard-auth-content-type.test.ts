/**
 * PAN-5188 WI-4 (D-5): rejectUnsafeDashboardMutationRequest accepts a named body
 * content type. The default stays application/json; the upload route asks for
 * application/octet-stream and keeps the same credential, Origin and CSRF checks.
 */
import { Option } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../../lib/internal-token.js';
import {
  _resetDashboardSessionTokenForTests,
  DASHBOARD_CSRF_HEADER,
  DASHBOARD_SESSION_COOKIE,
  dashboardCsrfToken,
  rejectUnsafeDashboardMutationRequest,
} from '../dashboard-auth.js';

const INTERNAL = 'content-type-internal-token';
const SESSION = 'content-type-session-token';
const ROUTE = { method: 'POST', url: '/api/explorer/upload?root=issue:PAN-1&name=a.bin' };
const OCTET = { contentType: 'application/octet-stream' };

function fakeRequest(headers: Record<string, string>) {
  return { ...ROUTE, headers, remoteAddress: Option.none() } as unknown as Parameters<
    typeof rejectUnsafeDashboardMutationRequest
  >[0];
}

async function errorOf(response: ReturnType<typeof rejectUnsafeDashboardMutationRequest>) {
  return { status: response?.status, body: JSON.parse(await HttpServerResponse.toWeb(response!).text()) as { error: string } };
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL;
  process.env.OVERDECK_DASHBOARD_SESSION_TOKEN = SESSION;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

afterEach(() => {
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  delete process.env.OVERDECK_DASHBOARD_SESSION_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
});

describe('content-type option with the internal-token credential', () => {
  const internal = { [INTERNAL_TOKEN_HEADER]: INTERNAL };

  it('defaults to application/json', async () => {
    expect(rejectUnsafeDashboardMutationRequest(fakeRequest({ ...internal, 'content-type': 'application/json' }))).toBeNull();
    const refused = await errorOf(
      rejectUnsafeDashboardMutationRequest(fakeRequest({ ...internal, 'content-type': 'application/octet-stream' })),
    );
    expect(refused).toEqual({ status: 400, body: { error: 'Content-Type must be application/json' } });
  });

  it('accepts the named type with parameters and refuses JSON when octet-stream is named', async () => {
    const binary = fakeRequest({ ...internal, 'content-type': 'application/octet-stream; charset=binary' });
    expect(rejectUnsafeDashboardMutationRequest(binary, OCTET)).toBeNull();
    const refused = await errorOf(
      rejectUnsafeDashboardMutationRequest(fakeRequest({ ...internal, 'content-type': 'application/json' }), OCTET),
    );
    expect(refused).toEqual({ status: 400, body: { error: 'Content-Type must be application/octet-stream' } });
  });
});

describe('content-type option with the browser cookie session', () => {
  const browser = {
    cookie: `${DASHBOARD_SESSION_COOKIE}=${SESSION}`,
    origin: 'http://localhost:3010',
    'content-type': 'application/octet-stream',
  };

  it('still requires the CSRF token', async () => {
    const refused = await errorOf(rejectUnsafeDashboardMutationRequest(fakeRequest(browser), OCTET));
    expect(refused).toEqual({ status: 403, body: { error: 'Invalid CSRF token' } });
  });

  it('admits the request with the CSRF token', () => {
    const request = fakeRequest({ ...browser, [DASHBOARD_CSRF_HEADER]: dashboardCsrfToken() });
    expect(rejectUnsafeDashboardMutationRequest(request, OCTET)).toBeNull();
  });
});
