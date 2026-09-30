/**
 * PAN-3762 W2.2: a paired device's `odk_` credential authenticates dashboard
 * requests until it is revoked, and the session mint refreshes the device
 * cookie without ever issuing the root `overdeck_session` cookie (FR-16).
 * PAN-2351 W2: `kind: 'token'` records resolve only from the Bearer header,
 * every registry credential carries its scopes, and a Bearer token skips CSRF.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, revokeAccessToken } from '../../../lib/access-tokens.js';
import { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } from '../../../lib/internal-token.js';
import { revocableCredentialId } from '../device-connections.js';
import {
  _resetDashboardSessionTokenForTests,
  credentialScopes,
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
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
    expect(resolveDashboardCredential(request.headers as Record<string, string>)).toEqual({ kind: 'device', deviceId: record.id, scopes: ['admin'] });

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

describe('token credentials (PAN-2351)', () => {
  it('resolves a token record sent as Bearer to a token credential with its scopes', async () => {
    const { token, record } = await createAccessToken({ name: 'sidecar', scopes: ['read:events', 'tell'], kind: 'token' });
    const credential = resolveDashboardCredential({ authorization: `Bearer ${token}` });
    expect(credential).toEqual({ kind: 'token', tokenId: record.id, scopes: ['read:events', 'tell'] });
    expect(credential && credentialScopes(credential)).toEqual(['read:events', 'tell']);
  });

  it('resolves the same token plaintext in the overdeck_device cookie to nothing', async () => {
    const { token } = await createAccessToken({ name: 'sidecar', scopes: ['admin'], kind: 'token' });
    expect(resolveDashboardCredential({ cookie: `overdeck_device=${token}` })).toBeNull();
    expect(resolveDashboardCredential({ cookie: `overdeck_device=${token}`, authorization: `Bearer ${token}` })).toBeNull();
    expect(rejectUnauthorizedDashboardRequest(fakeRequest({ cookie: `overdeck_device=${token}` }))?.status).toBe(401);
  });

  it('resolves a device record, and a record with no kind, as a device carrying its scopes', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const legacy = await createAccessToken({ name: 'legacy', scopes: ['read:state'] });
    expect(resolveDashboardCredential({ authorization: `Bearer ${device.token}` }))
      .toEqual({ kind: 'device', deviceId: device.record.id, scopes: ['admin'] });
    expect(resolveDashboardCredential({ cookie: `overdeck_device=${legacy.token}` }))
      .toEqual({ kind: 'device', deviceId: legacy.record.id, scopes: ['read:state'] });
  });

  it('grants admin to root credentials', () => {
    expect(credentialScopes({ kind: 'internal-token' })).toEqual(['admin']);
    expect(credentialScopes({ kind: 'root-session' })).toEqual(['admin']);
  });

  it('lets a Bearer token POST skip CSRF while a device cookie POST without CSRF gets 403', async () => {
    const { token } = await createAccessToken({ name: 'teller', scopes: ['tell'], kind: 'token' });
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const json = { 'content-type': 'application/json' };
    expect(rejectUnsafeDashboardMutationRequest(fakeRequest({ ...json, authorization: `Bearer ${token}` }))).toBeNull();
    expect(rejectUnsafeDashboardMutationRequest(fakeRequest({ ...json, cookie: `overdeck_device=${device.token}` }))?.status).toBe(403);
    expect(rejectUnsafeDashboardMutationRequest(fakeRequest({ ...json, authorization: `Bearer ${device.token}` }))?.status).toBe(403);
  });

  it('revocableCredentialId returns the record id for device and token, null for root credentials', () => {
    expect(revocableCredentialId({ kind: 'device', deviceId: 'd-1', scopes: ['admin'] })).toBe('d-1');
    expect(revocableCredentialId({ kind: 'token', tokenId: 't-1', scopes: ['tell'] })).toBe('t-1');
    expect(revocableCredentialId({ kind: 'internal-token' })).toBeNull();
    expect(revocableCredentialId({ kind: 'root-session' })).toBeNull();
    expect(revocableCredentialId(null)).toBeNull();
  });
});
