/**
 * PAN-3762 W2.2: a paired device's `odk_` credential authenticates dashboard
 * requests until it is revoked, and the session mint refreshes the device
 * cookie without ever issuing the root `overdeck_session` cookie (FR-16).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, revokeAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import {
  _resetDashboardSessionTokenForTests,
  rejectUnauthorizedDashboardRequest,
  resolveDashboardCredential,
} from '../routes/dashboard-auth.js';
import { dashboardSessionRouteLayer } from '../routes/dashboard-session.js';

const INTERNAL_TOKEN = 'device-auth-internal-token';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

function fakeRequest(headers: Record<string, string>) {
  return { headers, remoteAddress: Option.none() } as unknown as Parameters<typeof rejectUnauthorizedDashboardRequest>[0];
}

async function mint(headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/dashboard/session', {
    method: 'POST',
    headers: { Origin: 'http://localhost:3011', ...headers },
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(dashboardSessionRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const { status, headers: responseHeaders } = response as { status: number; headers: Record<string, string> };
  return { status, setCookie: responseHeaders['set-cookie'] ?? '' };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-3762-device-auth-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('device credentials in dashboard auth (PAN-3762)', () => {
  it('accepts a valid device cookie and rejects it with 401 once revoked', async () => {
    const { token, record } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const request = fakeRequest({ cookie: `overdeck_device=${token}` });

    expect(rejectUnauthorizedDashboardRequest(request)).toBeNull();
    expect(resolveDashboardCredential(request.headers as Record<string, string>)).toEqual({ kind: 'device', deviceId: record.id });

    await revokeAccessToken(record.id);
    expect(rejectUnauthorizedDashboardRequest(request)?.status).toBe(401);
  });

  it('accepts a device token as Authorization: Bearer', async () => {
    const { token } = await createAccessToken({ name: 'desktop', scopes: ['admin'], kind: 'device' });
    expect(rejectUnauthorizedDashboardRequest(fakeRequest({ authorization: `Bearer ${token}` }))).toBeNull();
    expect(rejectUnauthorizedDashboardRequest(fakeRequest({ authorization: 'Bearer odk_unknown' }))?.status).toBe(401);
  });

  it('refreshes overdeck_device and never sets overdeck_session on a device-authenticated mint', async () => {
    const { token } = await createAccessToken({ name: 'tablet', scopes: ['admin'], kind: 'device' });
    const res = await mint({ cookie: `overdeck_device=${token}` });
    expect(res.status).toBe(200);
    expect(res.setCookie).toContain(`overdeck_device=${token}`);
    expect(res.setCookie).toContain('HttpOnly');
    expect(res.setCookie).not.toContain('overdeck_session');
  });

  it('still sets overdeck_session on an internal-token mint', async () => {
    const res = await mint({ [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
    expect(res.status).toBe(200);
    expect(res.setCookie).toContain('overdeck_session=');
    expect(res.setCookie).not.toContain('overdeck_device');
  });

  it('rejects a mint from a revoked device on a non-loopback peer', async () => {
    const { token, record } = await createAccessToken({ name: 'lost', scopes: ['admin'], kind: 'device' });
    await revokeAccessToken(record.id);
    const res = await mint({ cookie: `overdeck_device=${token}` });
    expect(res.status).toBe(401);
    expect(res.setCookie).toBe('');
  });
});
