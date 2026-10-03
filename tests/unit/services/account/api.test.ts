import { describe, expect, it } from 'vitest';
import { mintDevice } from '../../../../services/account/src/devices.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import { addGrant } from '../../../../services/account/src/grants.ts';
import { call, dbOf, makeDeps, makeEnv, makeRc, TEST_OWNER_GITHUB_ID, type TestDeps } from './helpers/harness.ts';

const ENV_A = '11111111-2222-4333-8444-555555555555';
const ENV_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const HOUR = 3_600_000;

async function setup() {
  const env = makeEnv();
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12) });
  const rc = makeRc({ env, deps });
  await rc.env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
    .bind('u-alice', 100, 'alice', deps.now(), 'u-bob', 200, 'bob', deps.now())
    .run();
  await addGrant(rc, 100, 'alice', { expiresAt: deps.now() + HOUR, storageCapBytes: 2147483648 }, 'admin-add');
  await addGrant(rc, 200, 'bob', {}, 'admin-add');
  const alice = await mintDevice(rc, 'u-alice', 'linux-x64', ENV_A);
  deps.clock.advance(1_000);
  const alice2 = await mintDevice(rc, 'u-alice', 'darwin-arm64', ENV_B);
  const bob = await mintDevice(rc, 'u-bob', 'win32-x64', ENV_A);
  return { env, deps, rc, alice, alice2, bob };
}

function api(env: Env, deps: TestDeps, token: string, method: string, path: string, body?: unknown) {
  return call(method, path, {
    env,
    deps,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

describe('device API (PAN-4293 account-device-api)', () => {
  it('GET /v1/me returns the caller’s identity, device, entitlement and access status', async () => {
    const { env, deps, alice } = await setup();
    const res = await api(env, deps, alice.token, 'GET', '/v1/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: 'u-alice',
      githubId: 100,
      githubLogin: 'alice',
      deviceId: alice.deviceId,
      entitlement: { plan: 'tester', storageBytesCap: 2147483648, maxDevices: null },
      access: { status: 'active', expiresAt: deps.now() - 1_000 + HOUR },
    });
  });

  it('GET /v1/devices lists only the caller’s active devices with current, oldest first', async () => {
    const { env, deps, rc, alice, alice2 } = await setup();
    const res = await api(env, deps, alice2.token, 'GET', '/v1/devices');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { devices: Array<Record<string, unknown>> };
    expect(body.devices).toEqual([
      { deviceId: alice.deviceId, label: 'Linux device', platform: 'linux-x64', environmentId: ENV_A, createdAt: deps.now() - 1_000, lastUsedAt: null, current: false },
      { deviceId: alice2.deviceId, label: 'macOS device', platform: 'darwin-arm64', environmentId: ENV_B, createdAt: deps.now(), lastUsedAt: deps.now(), current: true },
    ]);
    await rc.env.DB.prepare("UPDATE devices SET revoked_at = 1, revoked_by = 'user' WHERE device_id = ?").bind(alice.deviceId).run();
    const after = (await (await api(env, deps, alice2.token, 'GET', '/v1/devices')).json()) as { devices: unknown[] };
    expect(after.devices).toHaveLength(1);
  });

  it('PATCH /v1/devices/:id validates the label and renames only the caller’s device', async () => {
    const { env, deps, alice, alice2, bob } = await setup();
    for (const label of ['', '   ', 'x'.repeat(65), 'bad\u0001label', 42, null]) {
      const res = await api(env, deps, alice.token, 'PATCH', `/v1/devices/${alice2.deviceId}`, { label });
      expect(res.status, JSON.stringify(label)).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_label' });
    }
    const notJson = await call('PATCH', `/v1/devices/${alice2.deviceId}`, { env, deps, headers: { Authorization: `Bearer ${alice.token}` }, body: 'label=x' });
    expect(await notJson.json()).toEqual({ error: 'invalid_request' });

    const foreign = await api(env, deps, alice.token, 'PATCH', `/v1/devices/${bob.deviceId}`, { label: 'mine now' });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: 'not_found' });

    const ok = await api(env, deps, alice.token, 'PATCH', `/v1/devices/${alice2.deviceId}`, { label: '  work laptop ' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ deviceId: alice2.deviceId, label: 'work laptop', current: false });
    expect(await dbOf(env).prepare('SELECT label FROM devices WHERE device_id = ?').bind(bob.deviceId).first<string>('label')).toBe('Windows device');
  });

  it('DELETE /v1/devices/:id revokes only the caller’s device; the revoked token then gets 401 device_revoked', async () => {
    const { env, deps, alice, alice2, bob } = await setup();
    expect((await api(env, deps, alice.token, 'DELETE', `/v1/devices/${bob.deviceId}`)).status).toBe(404);
    expect((await api(env, deps, alice.token, 'DELETE', '/v1/devices/nope')).status).toBe(404);

    const other = await api(env, deps, alice.token, 'DELETE', `/v1/devices/${alice2.deviceId}`);
    expect(other.status).toBe(204);
    const revokedOther = await api(env, deps, alice2.token, 'GET', '/v1/me');
    expect(revokedOther.status).toBe(401);
    expect(await revokedOther.json()).toEqual({ error: 'device_revoked' });

    const self = await api(env, deps, alice.token, 'DELETE', `/v1/devices/${alice.deviceId}`);
    expect(self.status).toBe(204);
    const revokedSelf = await api(env, deps, alice.token, 'GET', '/v1/devices');
    expect(revokedSelf.status).toBe(401);
    expect(revokedSelf.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
    expect(await revokedSelf.json()).toEqual({ error: 'device_revoked' });
    expect((await api(env, deps, alice.token, 'DELETE', `/v1/devices/${alice.deviceId}`)).status).toBe(401);
    expect(await dbOf(env).prepare('SELECT revoked_by FROM devices WHERE device_id = ?').bind(alice.deviceId).first<string>('revoked_by')).toBe('user');
  });

  it('an expired grant gets 403 grant_expired on /v1/devices and PATCH but 200 on /v1/me and 204 on DELETE', async () => {
    const { env, deps, alice, alice2 } = await setup();
    deps.clock.advance(2 * HOUR);
    const devices = await api(env, deps, alice.token, 'GET', '/v1/devices');
    expect(devices.status).toBe(403);
    expect(await devices.json()).toEqual({ error: 'grant_expired' });
    expect((await api(env, deps, alice.token, 'PATCH', `/v1/devices/${alice2.deviceId}`, { label: 'x' })).status).toBe(403);

    const me = await api(env, deps, alice.token, 'GET', '/v1/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ access: { status: 'grant_expired', expiresAt: deps.now() - HOUR - 1_000 }, entitlement: { storageBytesCap: 5368709120 } });

    expect((await api(env, deps, alice.token, 'DELETE', `/v1/devices/${alice2.deviceId}`)).status).toBe(204);
  });

  it('the owner never expires and unauthenticated calls are 401 invalid_token', async () => {
    const { env, deps, rc } = await setup();
    await rc.env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u-owner', TEST_OWNER_GITHUB_ID, 'owner', deps.now()).run();
    const owner = await mintDevice(rc, 'u-owner', 'linux-x64', ENV_A);
    deps.clock.advance(365 * 24 * HOUR);
    expect(await (await api(env, deps, owner.token, 'GET', '/v1/me')).json()).toMatchObject({ access: { status: 'active', expiresAt: null } });

    const none = await call('GET', '/v1/me', { env, deps });
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'invalid_token' });
    expect((await api(env, deps, 'odd_' + 'a'.repeat(64), 'GET', '/v1/devices')).status).toBe(401);
  });
});
