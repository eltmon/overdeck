/**
 * PAN-3762 W2.4: GET /api/devices lists paired devices without their hashes;
 * DELETE /api/devices/:id revokes one, which cuts its cookie off on the next
 * request. A device may revoke itself but not another device.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken, rejectUnauthorizedDashboardRequest } = await import('../routes/dashboard-auth.js');
const { pairingRouteLayer } = await import('../routes/pairing.js');

const INTERNAL_TOKEN = 'devices-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function call(method: 'GET' | 'DELETE', path: string, headers: Record<string, string>) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers: method === 'DELETE' ? { 'Content-Type': 'application/json', ...headers } : headers,
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(pairingRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const raw = response as { status: number; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return { status: raw.status, text, json: text ? JSON.parse(text) : null };
}

const asInternal = { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN };
function asDevice(token: string) {
  return { cookie: `overdeck_device=${token}`, 'x-overdeck-csrf-token': dashboardCsrfToken() };
}
function stillAuthenticates(token: string): boolean {
  const request = { headers: { cookie: `overdeck_device=${token}` } } as unknown as Parameters<typeof rejectUnauthorizedDashboardRequest>[0];
  return rejectUnauthorizedDashboardRequest(request) === null;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-3762-devices-'));
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

describe('device list and revoke routes (PAN-3762)', () => {
  it('lists only devices and never includes tokenHash', async () => {
    const { record } = await createAccessToken({ name: 'phone', scopes: ['admin'], kind: 'device' });
    await createAccessToken({ name: 'ci-token', scopes: ['admin'], kind: 'token' });

    const res = await call('GET', '/api/devices', asInternal);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('tokenHash');
    expect(res.json.devices).toEqual([
      { id: record.id, name: 'phone', createdAt: record.createdAt, lastUsedAt: null, revokedAt: null },
    ]);
  });

  it('rejects an uncredentialed list with 401', async () => {
    expect((await call('GET', '/api/devices', {})).status).toBe(401);
  });

  it('revokes a device so its cookie gets 401 on the next request', async () => {
    const { token, record } = await createAccessToken({ name: 'lost', scopes: ['admin'], kind: 'device' });
    expect(stillAuthenticates(token)).toBe(true);

    const res = await call('DELETE', `/api/devices/${record.id}`, asInternal);
    expect(res.status).toBe(200);
    expect(res.json.device.revokedAt).toEqual(expect.any(String));
    expect(stillAuthenticates(token)).toBe(false);
    expect((await call('GET', '/api/devices', asDevice(token))).status).toBe(401);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await call('DELETE', '/api/devices/no-such-device', asInternal)).status).toBe(404);
  });

  it('lets a device revoke itself but not another device, and B survives A', async () => {
    const a = await createAccessToken({ name: 'a', scopes: ['admin'], kind: 'device' });
    const b = await createAccessToken({ name: 'b', scopes: ['admin'], kind: 'device' });

    expect((await call('DELETE', `/api/devices/${b.record.id}`, asDevice(a.token))).status).toBe(403);
    expect(stillAuthenticates(b.token)).toBe(true);

    expect((await call('DELETE', `/api/devices/${a.record.id}`, asDevice(a.token))).status).toBe(200);
    expect(stillAuthenticates(a.token)).toBe(false);
    expect(stillAuthenticates(b.token)).toBe(true);
  });
});
