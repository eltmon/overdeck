/**
 * PAN-5019 WI-3: the machine store for phone notification preferences, keyed
 * by clientId and pruned against the active phone access-token records.
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AccessTokens = typeof import('../../../../src/lib/access-tokens.js');
type Store = typeof import('../../../../src/lib/push/phone-preferences-store.js');

const CLIENT_ID_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID_B = '22222222-2222-4222-8222-222222222222';
const PHONE_KEY_A = 'a1'.repeat(32);
const PHONE_KEY_B = 'b2'.repeat(32);

let accessTokens: AccessTokens;
let store: Store;
let home: string;
const originalHome = process.env.OVERDECK_HOME;

async function freshModules(): Promise<void> {
  vi.resetModules();
  accessTokens = await import('../../../../src/lib/access-tokens.js');
  store = await import('../../../../src/lib/push/phone-preferences-store.js');
}

async function phoneToken(clientId: string, phoneKey: string) {
  return accessTokens.createAccessToken({
    name: 'phone:test',
    kind: 'phone',
    scopes: [...accessTokens.PHONE_TOKEN_SCOPES],
    phoneKey,
    clientId,
  });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-5019-phone-prefs-'));
  process.env.OVERDECK_HOME = home;
  await freshModules();
});

afterEach(async () => {
  accessTokens._resetAccessTokensForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('phone preferences store (PAN-5019 WI-3)', () => {
  it('round-trips preferences for an active phone', async () => {
    await phoneToken(CLIENT_ID_A, PHONE_KEY_A);
    const prefs = { v: 1 as const, pause: null, muted: ['failed' as const] };
    await store.setPhoneNotificationPreferences(CLIENT_ID_A, prefs);
    const loaded = await store.loadPhoneNotificationPreferences();
    expect(loaded.get(CLIENT_ID_A)).toEqual(prefs);
  });

  it('writes the file with mode 0600', async () => {
    await phoneToken(CLIENT_ID_A, PHONE_KEY_A);
    await store.setPhoneNotificationPreferences(CLIENT_ID_A, { v: 1, pause: null, muted: [] });
    expect((await stat(store.phonePreferencesPath())).mode & 0o777).toBe(0o600);
  });

  it('loads a corrupt file as empty, then a later write succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await phoneToken(CLIENT_ID_A, PHONE_KEY_A);
    await mkdir(join(home, 'push'), { recursive: true });
    await writeFile(store.phonePreferencesPath(), 'not json', 'utf8');

    const loaded = await store.loadPhoneNotificationPreferences();
    expect(loaded.size).toBe(0);
    expect(warn).toHaveBeenCalled();

    store.resetPhoneNotificationPreferencesCacheForTests();
    const prefs = { v: 1 as const, pause: { until: null }, muted: [] };
    await store.setPhoneNotificationPreferences(CLIENT_ID_A, prefs);
    expect((await store.loadPhoneNotificationPreferences()).get(CLIENT_ID_A)).toEqual(prefs);
    warn.mockRestore();
  });

  it('prunes an entry for a revoked clientId on the next write', async () => {
    const { record: recordA } = await phoneToken(CLIENT_ID_A, PHONE_KEY_A);
    await phoneToken(CLIENT_ID_B, PHONE_KEY_B);
    await store.setPhoneNotificationPreferences(CLIENT_ID_A, { v: 1, pause: null, muted: [] });
    await store.setPhoneNotificationPreferences(CLIENT_ID_B, { v: 1, pause: null, muted: [] });

    await accessTokens.revokeAccessToken(recordA.id);
    await store.setPhoneNotificationPreferences(CLIENT_ID_B, { v: 1, pause: { until: null }, muted: [] });

    const loaded = await store.loadPhoneNotificationPreferences();
    expect(loaded.has(CLIENT_ID_A)).toBe(false);
    expect(loaded.get(CLIENT_ID_B)).toEqual({ v: 1, pause: { until: null }, muted: [] });
  });

  it('reads a missing file as an empty map', async () => {
    const loaded = await store.loadPhoneNotificationPreferences();
    expect(loaded.size).toBe(0);
  });
});
