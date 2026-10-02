import { describe, expect, it } from 'vitest';
import { DEFAULT_STORAGE_CAP_BYTES, entitlementFor, quotaDecision } from '../../../../services/account/src/entitlement.ts';
import {
  addGrant,
  getActiveGrant,
  getPendingAttempt,
  isAllowed,
  listGrantsWithDeviceStats,
  listPendingAttempts,
  recordPendingAttempt,
  revokeGrant,
} from '../../../../services/account/src/grants.ts';
import { dbOf, makeDeps, makeEnv, makeRc, TEST_OWNER_GITHUB_ID } from './helpers/harness.ts';

const HOUR = 3_600_000;

function setup(now = Date.UTC(2026, 9, 1)) {
  const env = makeEnv();
  const deps = makeDeps({ now });
  const rc = makeRc({ env, deps });
  return { env, deps, rc, db: dbOf(env) };
}

async function seedUser(rc: ReturnType<typeof makeRc>, userId: string, githubId: number) {
  await rc.env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, githubId, `user${githubId}`, rc.deps.now())
    .run();
}

async function seedDevice(rc: ReturnType<typeof makeRc>, deviceId: string, userId: string, lastUsedAt: number | null = null) {
  await rc.env.DB.prepare(
    'INSERT INTO devices (device_id, user_id, token_hash, platform, label, environment_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(deviceId, userId, `hash-${deviceId}`, 'linux-x64', 'Linux device', `env-${deviceId}`, rc.deps.now(), lastUsedAt)
    .run();
}

describe('allowlist (PAN-4293 account-grants)', () => {
  it('the owner is allowed with no grant row', async () => {
    const { rc } = setup();
    expect(await isAllowed(rc, TEST_OWNER_GITHUB_ID)).toBe(true);
    expect(await getActiveGrant(rc, TEST_OWNER_GITHUB_ID)).toBeNull();
  });

  it('the owner bypass is off when OWNER_GITHUB_ID is unset', async () => {
    const env = makeEnv({ OWNER_GITHUB_ID: undefined });
    const rc = makeRc({ env });
    expect(rc.config.ownerGithubId).toBeNull();
    expect(await isAllowed(rc, TEST_OWNER_GITHUB_ID)).toBe(false);
  });

  it('an unexpired grant is allowed; an expired grant and an unknown id are not', async () => {
    const { rc, deps } = setup();
    await addGrant(rc, 100, 'alice', { expiresAt: deps.now() + HOUR }, 'admin-add');
    await addGrant(rc, 200, 'bob', { expiresAt: deps.now() - 1 }, 'admin-add');
    expect(await isAllowed(rc, 100)).toBe(true);
    expect(await isAllowed(rc, 200)).toBe(false);
    expect(await isAllowed(rc, 300)).toBe(false);

    deps.clock.advance(2 * HOUR);
    expect(await isAllowed(rc, 100)).toBe(false);
  });

  it('a grant without expiry never expires', async () => {
    const { rc, deps } = setup();
    await addGrant(rc, 100, 'alice', {}, 'admin-allow-pending');
    deps.clock.advance(365 * 24 * HOUR);
    const grant = await getActiveGrant(rc, 100);
    expect(grant).toMatchObject({ github_id: 100, github_login: 'alice', entitlement: 'tester', expires_at: null, storage_cap_bytes: null, note: null, granted_via: 'admin-allow-pending' });
  });

  it('addGrant is an upsert that refreshes note, expiry, cap and login and drops the pending row', async () => {
    const { rc, deps } = setup();
    await recordPendingAttempt(rc, 100, 'alice', 'pkce');
    const first = await addGrant(rc, 100, 'alice', { note: 'beta', storageCapBytes: 2 * 1024 ** 3 }, 'admin-add');
    expect(first).toMatchObject({ note: 'beta', storage_cap_bytes: 2147483648, expires_at: null });
    expect(await getPendingAttempt(rc, 100)).toBeNull();

    deps.clock.advance(HOUR);
    const second = await addGrant(rc, 100, 'alice-renamed', { note: 'extended', expiresAt: deps.now() + HOUR, storageCapBytes: null }, 'admin-add');
    expect(second).toMatchObject({ github_login: 'alice-renamed', note: 'extended', storage_cap_bytes: null, expires_at: deps.now() + HOUR, granted_at: deps.now() });
    expect((await listGrantsWithDeviceStats(rc)).length).toBe(1);
  });

  it('two attempts for one id leave one row with attempts = 2 and the latest flow', async () => {
    const { rc, deps } = setup();
    await recordPendingAttempt(rc, 500, 'carol', 'pkce');
    deps.clock.advance(HOUR);
    await recordPendingAttempt(rc, 500, 'carol2', 'device');
    const rows = await listPendingAttempts(rc);
    expect(rows).toEqual([
      { github_id: 500, github_login: 'carol2', first_seen_at: deps.now() - HOUR, last_seen_at: deps.now(), attempts: 2, last_flow: 'device' },
    ]);
  });

  it('revokeGrant removes the grant and revokes only that account’s active devices with revoked_by = operator', async () => {
    const { rc, db } = setup();
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    await addGrant(rc, 200, 'bob', {}, 'admin-add');
    await seedUser(rc, 'u-alice', 100);
    await seedUser(rc, 'u-bob', 200);
    await seedDevice(rc, 'a1', 'u-alice');
    await seedDevice(rc, 'a2', 'u-alice');
    await seedDevice(rc, 'b1', 'u-bob');
    await db.prepare("UPDATE devices SET revoked_at = 1, revoked_by = 'user' WHERE device_id = 'a2'").run();

    expect(await revokeGrant(rc, 100)).toBe(true);
    expect(await isAllowed(rc, 100)).toBe(false);
    expect(await isAllowed(rc, 200)).toBe(true);

    const devices = (await db.prepare('SELECT device_id, revoked_at, revoked_by FROM devices ORDER BY device_id').all()).results;
    expect(devices).toEqual([
      { device_id: 'a1', revoked_at: rc.deps.now(), revoked_by: 'operator' },
      { device_id: 'a2', revoked_at: 1, revoked_by: 'user' },
      { device_id: 'b1', revoked_at: null, revoked_by: null },
    ]);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM users').first<number>('n')).toBe(2);
    expect(await revokeGrant(rc, 100)).toBe(false);
  });

  it('listGrantsWithDeviceStats orders newest first with active device count and last activity', async () => {
    const { rc, deps } = setup();
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    deps.clock.advance(HOUR);
    await addGrant(rc, 200, 'bob', {}, 'admin-add');
    await seedUser(rc, 'u-alice', 100);
    await seedDevice(rc, 'a1', 'u-alice', 5_000);
    await seedDevice(rc, 'a2', 'u-alice', 9_000);
    await seedDevice(rc, 'a3', 'u-alice', 50_000);
    await rc.env.DB.prepare("UPDATE devices SET revoked_at = 1, revoked_by = 'user' WHERE device_id = 'a3'").run();

    const rows = await listGrantsWithDeviceStats(rc);
    expect(rows.map((r) => r.github_id)).toEqual([200, 100]);
    expect(rows[1]).toMatchObject({ active_devices: 2, last_seen_at: 9_000 });
    expect(rows[0]).toMatchObject({ active_devices: 0, last_seen_at: null });
  });
});

describe('entitlement and storage cap (D-26, D-27)', () => {
  it('entitlementFor(null) is the tester plan with the 5 GB default cap', () => {
    expect(DEFAULT_STORAGE_CAP_BYTES).toBe(5368709120);
    expect(entitlementFor(null)).toEqual({ plan: 'tester', storageBytesCap: 5368709120, maxDevices: null });
  });

  it('a grant with storage_cap_bytes = 2147483648 yields that cap', async () => {
    const { rc } = setup();
    const grant = await addGrant(rc, 100, 'alice', { storageCapBytes: 2147483648 }, 'admin-add');
    expect(entitlementFor(grant).storageBytesCap).toBe(2147483648);
    expect(entitlementFor({ storage_cap_bytes: null }).storageBytesCap).toBe(DEFAULT_STORAGE_CAP_BYTES);
  });

  it('quotaDecision allows exactly-at-cap and refuses one byte over', () => {
    const e = entitlementFor({ storage_cap_bytes: 1000 });
    expect(quotaDecision(e, 600, 400)).toEqual({ allowed: true });
    expect(quotaDecision(e, 600, 401)).toEqual({ allowed: false, reason: 'quota_exceeded', capBytes: 1000, usedBytes: 600 });
    expect(quotaDecision(e, 0, 0)).toEqual({ allowed: true });
    expect(quotaDecision(entitlementFor(null), DEFAULT_STORAGE_CAP_BYTES, 1).allowed).toBe(false);
  });
});
