/**
 * PAN-2351 W7: the /api/access-tokens routes. Only root credentials create or
 * revoke tokens; the plaintext is returned once and never listed; revoking a
 * token closes its live connections and stops it verifying at once.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { emitActivityEntry } = await import('../../../lib/activity-logger.js');
const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, verifyAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { _deviceConnectionCountForTests, registerDeviceConnection } = await import('../device-connections.js');
const { accessTokensRouteLayer } = await import('../routes/access-tokens.js');

const INTERNAL_TOKEN = 'access-tokens-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, headers: Record<string, string>, body?: unknown) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers: method === 'GET' ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(accessTokensRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, cacheControl: raw.headers['cache-control'], text, json: text ? JSON.parse(text) : null };
}

const asInternal = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };
function asBearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2351-access-tokens-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  vi.mocked(emitActivityEntry).mockClear();
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

describe('access-token routes (PAN-2351)', () => {
  it('creates a token for the internal token, returns the plaintext once, and never lists it', async () => {
    await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const created = await call('POST', '/api/access-tokens', asInternal, { name: 'sidecar', scopes: ['read:events', 'tell'] });
    expect(created.status).toBe(200);
    expect(created.cacheControl).toBe('no-store');
    expect(created.json.token).toMatch(/^odk_[0-9a-f]{64}$/);
    expect(created.json.record).not.toHaveProperty('tokenHash');
    expect(created.json.record).toMatchObject({ name: 'sidecar', scopes: ['read:events', 'tell'], kind: 'token' });
    expect(JSON.stringify(vi.mocked(emitActivityEntry).mock.calls)).not.toContain(created.json.token);

    const listed = await call('GET', '/api/access-tokens', asInternal);
    expect(listed.status).toBe(200);
    expect(listed.cacheControl).toBe('no-store');
    expect(listed.json.tokens.map((record: { id: string }) => record.id)).toEqual([created.json.record.id]);
    expect(listed.text).not.toContain(created.json.token);
    expect(listed.text).not.toContain('tokenHash');
  });

  it('answers 400 for an unknown scope, an empty scope list, or a missing name', async () => {
    const unknown = await call('POST', '/api/access-tokens', asInternal, { name: 'x', scopes: ['write:all'] });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toContain('write:all');
    expect((await call('POST', '/api/access-tokens', asInternal, { name: 'x', scopes: [] })).status).toBe(400);
    expect((await call('POST', '/api/access-tokens', asInternal, { name: '', scopes: ['tell'] })).status).toBe(400);
    expect((await call('POST', '/api/access-tokens', asInternal, { scopes: ['tell'] })).status).toBe(400);
  });

  it('refuses creation from a device cookie and from an admin token', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    const admin = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    const body = { name: 'x', scopes: ['tell'] };
    const fromDevice = { cookie: `overdeck_device=${device.token}`, 'x-overdeck-csrf-token': dashboardCsrfToken() };
    expect((await call('POST', '/api/access-tokens', fromDevice, body)).status).toBe(403);
    expect((await call('POST', '/api/access-tokens', asBearer(admin.token), body)).status).toBe(403);
  });

  it('revokes a token, closes its live connection, and stops it verifying at once', async () => {
    const { token, record } = await createAccessToken({ name: 'sidecar', scopes: ['read:events'], kind: 'token' });
    const closer = vi.fn();
    registerDeviceConnection(record.id, closer);

    const res = await call('DELETE', `/api/access-tokens/${record.id}`, asInternal);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, closedConnections: 1, token: { id: record.id, revokedAt: expect.any(String) } });
    expect(closer).toHaveBeenCalledOnce();
    expect(_deviceConnectionCountForTests(record.id)).toBe(0);
    expect(verifyAccessToken(token).ok).toBe(false);
  });

  it('answers 404 for a device id or an unknown id', async () => {
    const device = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    expect((await call('DELETE', `/api/access-tokens/${device.record.id}`, asInternal)).status).toBe(404);
    expect((await call('DELETE', '/api/access-tokens/no-such-token', asInternal)).status).toBe(404);
    expect(verifyAccessToken(device.token).ok).toBe(true);
  });

  it('refuses revocation from an admin token and leaves the target active', async () => {
    const admin = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    const target = await createAccessToken({ name: 'sidecar', scopes: ['read:events'], kind: 'token' });
    expect((await call('DELETE', `/api/access-tokens/${target.record.id}`, asBearer(admin.token))).status).toBe(403);
    expect(verifyAccessToken(target.token).ok).toBe(true);
  });
});
