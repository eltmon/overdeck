/**
 * PAN-4835 WI-1: the `phone` token kind — binding fields, PHONE_TOKEN_SCOPES,
 * fail-closed parsing of a malformed phone record, `findActiveChannelTokenByKey`
 * and `setPhonePushKey`.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Registry = typeof import('../../../src/lib/access-tokens.js');

let registry: Registry;
let home: string;
const originalHome = process.env.OVERDECK_HOME;
const PHONE_KEY_A = 'a1'.repeat(32);
const PHONE_KEY_B = 'b2'.repeat(32);
const PUSH_KEY_A = 'c3'.repeat(32);
const CLIENT_ID_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID_B = '22222222-2222-4222-8222-222222222222';
const MACHINE_KEY_A = 'd4'.repeat(32);

async function freshModule(): Promise<Registry> {
  vi.resetModules();
  return import('../../../src/lib/access-tokens.js');
}

async function phoneToken(overrides: Partial<Parameters<Registry['createAccessToken']>[0]> = {}) {
  return registry.createAccessToken({
    name: 'phone:iris',
    kind: 'phone',
    scopes: [...registry.PHONE_TOKEN_SCOPES],
    phoneKey: PHONE_KEY_A,
    clientId: CLIENT_ID_A,
    pushKey: PUSH_KEY_A,
    ...overrides,
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
  home = await mkdtemp(join(tmpdir(), 'pan-4835-phone-tokens-'));
  process.env.OVERDECK_HOME = home;
  registry = await freshModule();
});

afterEach(async () => {
  await registry._settleAccessTokenWritesForTests();
  registry._resetAccessTokensForTests();
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('phone access tokens (PAN-4835 WI-1)', () => {
  it('creates a phone record bound to a key, client id and push key, and reads all three back', async () => {
    const { token, record } = await phoneToken();
    expect(record).toMatchObject({ kind: 'phone', phoneKey: PHONE_KEY_A, clientId: CLIENT_ID_A, pushKey: PUSH_KEY_A });
    expect(record).not.toHaveProperty('tokenHash');
    expect(record.scopes).toEqual(['read:events', 'read:state', 'read:conversations', 'read:costs', 'read:settings', 'tell', 'operate', 'approve']);
    expect(registry.PHONE_TOKEN_SCOPES).not.toContain('admin');
    expect(registry.PHONE_TOKEN_SCOPES).not.toContain('forward');

    const verified = registry.verifyAccessToken(token);
    expect(verified.ok && verified.record.id).toBe(record.id);
    expect(registry.listActiveRecordsOfKind('phone').map((r) => r.id)).toEqual([record.id]);

    // Re-reading from a fresh module (simulating a restart) returns the same fields.
    registry.stopAccessTokenRefresh();
    const reloaded = await registry.listAccessTokens();
    expect(reloaded).toContainEqual(expect.objectContaining({ kind: 'phone', phoneKey: PHONE_KEY_A, clientId: CLIENT_ID_A, pushKey: PUSH_KEY_A }));
  });

  it('refuses admin or forward scopes, a malformed phoneKey/clientId, and phone fields on a device token', async () => {
    await expect(phoneToken({ scopes: [...registry.PHONE_TOKEN_SCOPES, 'admin'] })).rejects.toThrow(/never carries admin or forward/);
    await expect(phoneToken({ scopes: [...registry.PHONE_TOKEN_SCOPES, 'forward'] })).rejects.toThrow(/never carries admin or forward/);
    await expect(phoneToken({ phoneKey: 'AB'.repeat(32) })).rejects.toThrow(/phoneKey/);
    await expect(phoneToken({ clientId: 'not-a-uuid' })).rejects.toThrow(/clientId/);
    await expect(phoneToken({ pushKey: 'zz'.repeat(32) })).rejects.toThrow(/pushKey/);
    await expect(
      registry.createAccessToken({ name: 'dev', scopes: ['tell'], kind: 'device', phoneKey: PHONE_KEY_A }),
    ).rejects.toThrow(/kind: phone only/);
    await expect(
      registry.createAccessToken({ name: 'phone', scopes: [...registry.PHONE_TOKEN_SCOPES], kind: 'phone', phoneKey: PHONE_KEY_A, clientId: CLIENT_ID_A, machineKey: MACHINE_KEY_A }),
    ).rejects.toThrow(/kind: machine only/);
    expect(await registry.listAccessTokens()).toEqual([]);
  });

  it('treats a registry holding a phone record without clientId as corrupt', async () => {
    const { record } = await phoneToken();
    const machine = await registry.createAccessToken({
      name: 'machine:desk',
      kind: 'machine',
      scopes: registry.MACHINE_TOKEN_SCOPES('operator'),
      machineKey: MACHINE_KEY_A,
      environmentId: 'env-desk',
      access: 'operator',
    });
    const path = join(home, 'access-tokens.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as { tokens: Array<Record<string, unknown>> };
    const phoneEntry = file.tokens.find((t) => t.id === record.id)!;
    delete phoneEntry.clientId;
    await writeFile(path, JSON.stringify(file), 'utf8');

    await expect(registry.refreshAccessTokens()).rejects.toThrow(/unexpected shape/);
    expect(registry.verifyAccessToken(machine.token)).toEqual({ ok: false });
    expect(registry.findActiveChannelTokenByKey(MACHINE_KEY_A)).toBeNull();
    expect(registry.listActiveRecordsOfKind('phone')).toEqual([]);
  });

  it('findActiveChannelTokenByKey finds a machine key and a phone key, and ignores revoked records', async () => {
    const machine = await registry.createAccessToken({
      name: 'machine:desk',
      kind: 'machine',
      scopes: registry.MACHINE_TOKEN_SCOPES('operator'),
      machineKey: MACHINE_KEY_A,
      environmentId: 'env-desk',
      access: 'operator',
    });
    const phone = await phoneToken();

    expect(registry.findActiveChannelTokenByKey(MACHINE_KEY_A)?.id).toBe(machine.record.id);
    expect(registry.findActiveChannelTokenByKey(PHONE_KEY_A)?.id).toBe(phone.record.id);
    expect(registry.findActiveChannelTokenByKey(PHONE_KEY_B)).toBeNull();

    await registry.revokeAccessToken(phone.record.id);
    expect(registry.findActiveChannelTokenByKey(PHONE_KEY_A)).toBeNull();
    await registry.revokeAccessToken(machine.record.id);
    expect(registry.findActiveChannelTokenByKey(MACHINE_KEY_A)).toBeNull();
  });

  it('setPhonePushKey updates an active phone record and returns null for a revoked one', async () => {
    const { record } = await phoneToken({ clientId: CLIENT_ID_B, pushKey: undefined });
    const newPushKey = 'ff'.repeat(32);

    const updated = await registry.setPhonePushKey(record.id, newPushKey);
    expect(updated?.pushKey).toBe(newPushKey);
    expect(registry.listActiveRecordsOfKind('phone')[0]?.pushKey).toBe(newPushKey);

    await expect(registry.setPhonePushKey(record.id, 'not-hex')).rejects.toThrow(/pushKey/);

    await registry.revokeAccessToken(record.id);
    expect(await registry.setPhonePushKey(record.id, 'ee'.repeat(32))).toBeNull();
    expect(await registry.setPhonePushKey('unknown-id', newPushKey)).toBeNull();
  });
});
