import { describe, expect, it } from 'vitest';
import { randomHex, s256Challenge, sha256Hex, USER_CODE_ALPHABET, userCode } from '../../../../services/account/src/crypto.ts';
import {
  authenticateRequest,
  defaultLabel,
  isValidEnvironmentId,
  isValidPlatform,
  listDevicesForUser,
  mintDevice,
  normalizeLabel,
  renameDevice,
  revokeAllForUser,
  revokeDevice,
  verifyDeviceToken,
} from '../../../../services/account/src/devices.ts';
import { addGrant } from '../../../../services/account/src/grants.ts';
import { dumpAllTables } from './helpers/d1.ts';
import { dbOf, makeDeps, makeEnv, makeRc, TEST_OWNER_GITHUB_ID } from './helpers/harness.ts';

const MIN = 60_000;
const ENV_A = '11111111-2222-4333-8444-555555555555';
const ENV_B = '66666666-7777-4888-9999-aaaaaaaaaaaa';

function setup() {
  const env = makeEnv();
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12) });
  const rc = makeRc({ env, deps });
  return { env, deps, rc, db: dbOf(env) };
}

async function seedUser(rc: ReturnType<typeof makeRc>, userId: string, githubId: number) {
  await rc.env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, githubId, `user${githubId}`, rc.deps.now())
    .run();
}

describe('crypto helpers', () => {
  it('randomHex and sha256Hex produce lowercase hex of the right width', async () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(randomHex(32)).not.toBe(randomHex(32));
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('s256Challenge matches the RFC 7636 appendix B vector', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('userCode is 8 letters from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = userCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(USER_CODE_ALPHABET).toContain(ch);
    }
  });
});

describe('device records (PAN-4293 account-device-credentials)', () => {
  it('mints odd_ + 64 hex and stores only its SHA-256 hash', async () => {
    const { rc, db } = setup();
    await seedUser(rc, 'u1', TEST_OWNER_GITHUB_ID);
    const minted = await mintDevice(rc, 'u1', 'linux-x64', ENV_A);
    expect(minted.token).toMatch(/^odd_[0-9a-f]{64}$/);
    expect(minted.label).toBe('Linux device');
    expect(minted.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await db.prepare('SELECT token_hash FROM devices WHERE device_id = ?').bind(minted.deviceId).first<string>('token_hash');
    expect(row).toBe(await sha256Hex(minted.token));
    expect(dumpAllTables(db)).not.toContain(minted.token);
  });

  it('re-minting for the same (user, environmentId) keeps deviceId and label and kills the old token', async () => {
    const { rc, deps } = setup();
    await seedUser(rc, 'u1', TEST_OWNER_GITHUB_ID);
    const first = await mintDevice(rc, 'u1', 'linux-x64', ENV_A);
    await renameDevice(rc, 'u1', first.deviceId, 'laptop');
    deps.clock.advance(MIN);
    const second = await mintDevice(rc, 'u1', 'linux-arm64', ENV_A);
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.label).toBe('laptop');
    expect(second.token).not.toBe(first.token);
    expect(await verifyDeviceToken(rc, first.token)).toEqual({ ok: false, error: 'invalid_token' });
    expect((await verifyDeviceToken(rc, second.token)).ok).toBe(true);

    deps.clock.advance(MIN);
    const other = await mintDevice(rc, 'u1', 'linux-x64', ENV_B);
    expect(other.deviceId).not.toBe(first.deviceId);
    expect((await listDevicesForUser(rc, 'u1')).map((d) => d.device_id)).toEqual([first.deviceId, other.deviceId]);
  });

  it('rejects an invalid platform and a non-UUID environmentId', async () => {
    const { rc } = setup();
    await seedUser(rc, 'u1', TEST_OWNER_GITHUB_ID);
    expect(isValidPlatform('linux-x64')).toBe(true);
    expect(isValidPlatform('freebsd-x64')).toBe(false);
    expect(isValidPlatform('linux-x86')).toBe(false);
    expect(isValidEnvironmentId(ENV_A)).toBe(true);
    expect(isValidEnvironmentId(ENV_B.toUpperCase())).toBe(false);
    expect(isValidEnvironmentId('11111111-2222-1333-8444-555555555555')).toBe(false);
    await expect(mintDevice(rc, 'u1', 'freebsd-x64', ENV_A)).rejects.toThrow(/platform/);
    await expect(mintDevice(rc, 'u1', 'linux-x64', 'not-a-uuid')).rejects.toThrow(/environmentId/);
  });

  it('default labels follow D-17 and labels are validated', () => {
    expect(defaultLabel('linux-x64')).toBe('Linux device');
    expect(defaultLabel('darwin-arm64')).toBe('macOS device');
    expect(defaultLabel('win32-x64')).toBe('Windows device');
    expect(normalizeLabel('  my laptop ')).toBe('my laptop');
    expect(normalizeLabel('')).toBeNull();
    expect(normalizeLabel('   ')).toBeNull();
    expect(normalizeLabel('x'.repeat(65))).toBeNull();
    expect(normalizeLabel('x'.repeat(64))).toBe('x'.repeat(64));
    expect(normalizeLabel('bad\u0007label')).toBeNull();
    expect(normalizeLabel(42)).toBeNull();
  });
});

describe('verifyDeviceToken (FR-5, FR-6)', () => {
  it('returns every error code from its scenario', async () => {
    const { rc, deps, db } = setup();
    expect(await verifyDeviceToken(rc, 'nope')).toEqual({ ok: false, error: 'invalid_token' });
    expect(await verifyDeviceToken(rc, `odd_${'0'.repeat(64)}`)).toEqual({ ok: false, error: 'invalid_token' });

    await seedUser(rc, 'u-tester', 100);
    await addGrant(rc, 100, 'tester', { expiresAt: deps.now() + 60 * MIN }, 'admin-add');
    const tester = await mintDevice(rc, 'u-tester', 'darwin-arm64', ENV_A);
    expect((await verifyDeviceToken(rc, tester.token)).ok).toBe(true);

    deps.clock.advance(61 * MIN);
    expect(await verifyDeviceToken(rc, tester.token)).toEqual({ ok: false, error: 'grant_expired' });

    await seedUser(rc, 'u-nogrant', 200);
    const nogrant = await mintDevice(rc, 'u-nogrant', 'linux-x64', ENV_A);
    expect(await verifyDeviceToken(rc, nogrant.token)).toEqual({ ok: false, error: 'grant_expired' });

    expect(await revokeDevice(rc, 'u-tester', tester.deviceId)).toBe(true);
    expect(await verifyDeviceToken(rc, tester.token)).toEqual({ ok: false, error: 'device_revoked' });
    expect(await revokeDevice(rc, 'u-tester', tester.deviceId)).toBe(false);

    await db.prepare('UPDATE users SET deleted_at = ? WHERE user_id = ?').bind(deps.now(), 'u-tester').run();
    expect(await verifyDeviceToken(rc, tester.token)).toEqual({ ok: false, error: 'account_deleted' });
  });

  it('ok: true carries the grant’s storage cap, and the owner gets the default cap with no grant', async () => {
    const { rc } = setup();
    await seedUser(rc, 'u-tester', 100);
    await addGrant(rc, 100, 'tester', { storageCapBytes: 2147483648 }, 'admin-add');
    const tester = await mintDevice(rc, 'u-tester', 'linux-x64', ENV_A);
    expect(await verifyDeviceToken(rc, tester.token)).toEqual({
      ok: true,
      userId: 'u-tester',
      githubId: 100,
      deviceId: tester.deviceId,
      entitlement: { plan: 'tester', storageBytesCap: 2147483648, maxDevices: null },
    });

    await seedUser(rc, 'u-owner', TEST_OWNER_GITHUB_ID);
    const owner = await mintDevice(rc, 'u-owner', 'linux-x64', ENV_A);
    expect(await verifyDeviceToken(rc, owner.token)).toMatchObject({ ok: true, entitlement: { storageBytesCap: 5368709120 } });
  });

  it('writes last_used_at on first verify, leaves it 4 minutes later and rewrites it 6 minutes later (D-18)', async () => {
    const { rc, deps, db } = setup();
    await seedUser(rc, 'u1', TEST_OWNER_GITHUB_ID);
    const minted = await mintDevice(rc, 'u1', 'linux-x64', ENV_A);
    const lastUsed = () => db.prepare('SELECT last_used_at FROM devices WHERE device_id = ?').bind(minted.deviceId).first<number | null>('last_used_at');
    expect(await lastUsed()).toBeNull();

    const t0 = deps.now();
    await verifyDeviceToken(rc, minted.token);
    expect(await lastUsed()).toBe(t0);

    deps.clock.advance(4 * MIN);
    await verifyDeviceToken(rc, minted.token);
    expect(await lastUsed()).toBe(t0);

    deps.clock.advance(2 * MIN);
    await verifyDeviceToken(rc, minted.token);
    expect(await lastUsed()).toBe(t0 + 6 * MIN);
  });
});

describe('authenticateRequest (D-15)', () => {
  it('maps missing or bad tokens to 401 with WWW-Authenticate and expired grants to 403 unless allowed', async () => {
    const { rc, deps } = setup();
    const none = await authenticateRequest(new Request('https://account.test/v1/me'), rc);
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.response.status).toBe(401);
      expect(none.response.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
      expect(await none.response.json()).toEqual({ error: 'invalid_token' });
    }

    await seedUser(rc, 'u1', 100);
    await addGrant(rc, 100, 'tester', { expiresAt: deps.now() + MIN }, 'admin-add');
    const minted = await mintDevice(rc, 'u1', 'win32-x64', ENV_A);
    const req = () => new Request('https://account.test/v1/me', { headers: { Authorization: `Bearer ${minted.token}` } });

    const live = await authenticateRequest(req(), rc);
    expect(live.ok).toBe(true);
    if (live.ok) expect(live.auth).toMatchObject({ userId: 'u1', githubId: 100, githubLogin: 'user100', deviceId: minted.deviceId, grantExpired: false, grantExpiresAt: deps.now() + MIN });

    deps.clock.advance(2 * MIN);
    const expired = await authenticateRequest(req(), rc);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.response.status).toBe(403);
      expect(await expired.response.json()).toEqual({ error: 'grant_expired' });
    }
    const allowed = await authenticateRequest(req(), rc, { allowExpiredGrant: true });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.auth.grantExpired).toBe(true);

    await revokeAllForUser(rc, 'u1', 'operator');
    const revoked = await authenticateRequest(req(), rc, { allowExpiredGrant: true });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(await revoked.response.json()).toEqual({ error: 'device_revoked' });
  });

  it('rename and revoke act only on the caller’s own active devices', async () => {
    const { rc } = setup();
    await seedUser(rc, 'u1', TEST_OWNER_GITHUB_ID);
    await seedUser(rc, 'u2', 100);
    const mine = await mintDevice(rc, 'u1', 'linux-x64', ENV_A);
    const theirs = await mintDevice(rc, 'u2', 'linux-x64', ENV_A);
    expect(await renameDevice(rc, 'u1', theirs.deviceId, 'hijack')).toBeNull();
    expect(await revokeDevice(rc, 'u1', theirs.deviceId)).toBe(false);
    expect((await renameDevice(rc, 'u1', mine.deviceId, 'desk'))?.label).toBe('desk');
    expect(await revokeAllForUser(rc, 'u2', 'account-deletion')).toBe(1);
    expect(await verifyDeviceToken(rc, theirs.token)).toEqual({ ok: false, error: 'device_revoked' });
  });
});
