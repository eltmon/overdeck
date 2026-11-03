import { beforeEach, describe, expect, it } from 'vitest';

import { type DeviceIdentity, loadIdentity, type OverdeckKeysPlugin } from '../keys';
import { OverdeckKeysWeb } from '../keys-web';

const VALID: DeviceIdentity = { clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9', pushPublicKeyHex: 'cd'.repeat(32) };

const returning = (identity: DeviceIdentity): OverdeckKeysPlugin =>
  ({ ensureKeys: async () => identity }) as unknown as OverdeckKeysPlugin;

beforeEach(() => {
  localStorage.clear();
});

describe('loadIdentity', () => {
  it('accepts a lowercase UUID v4 and a 64-hex push key', async () => {
    await expect(loadIdentity(returning(VALID))).resolves.toEqual(VALID);
  });

  it('rejects an uppercase client id', async () => {
    await expect(loadIdentity(returning({ ...VALID, clientId: VALID.clientId.toUpperCase() }))).rejects.toThrow(
      'Key storage returned an invalid identity',
    );
  });

  it('rejects a 63-character push key', async () => {
    await expect(loadIdentity(returning({ ...VALID, pushPublicKeyHex: 'c'.repeat(63) }))).rejects.toThrow(
      'Key storage returned an invalid identity',
    );
  });
});

describe('OverdeckKeysWeb', () => {
  it('returns the same valid identity on every call', async () => {
    const keys = new OverdeckKeysWeb();
    const first = await loadIdentity(keys);
    expect(await loadIdentity(new OverdeckKeysWeb())).toEqual(first);
  });

  it('round-trips a secret and removes it', async () => {
    const keys = new OverdeckKeysWeb();
    expect(await keys.getSecret({ name: 'account' })).toEqual({ value: null });
    await keys.setSecret({ name: 'account', value: '{"token":"t"}' });
    expect(await keys.getSecret({ name: 'account' })).toEqual({ value: '{"token":"t"}' });
    await keys.removeSecret({ name: 'account' });
    expect(await keys.getSecret({ name: 'account' })).toEqual({ value: null });
  });

  it('reset deletes the secrets and yields a new client id', async () => {
    const keys = new OverdeckKeysWeb();
    const before = await keys.ensureKeys();
    await keys.setSecret({ name: 'machines', value: '[]' });
    await keys.reset();
    expect(await keys.getSecret({ name: 'machines' })).toEqual({ value: null });
    expect((await keys.ensureKeys()).clientId).not.toBe(before.clientId);
  });
});
