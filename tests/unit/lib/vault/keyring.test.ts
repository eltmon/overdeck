import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HEADER_REF_NAME,
  encryptRef,
  newVaultHeader,
  refName,
  type MachineRecord,
  type VaultHeader,
} from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import {
  KeyGuardedStore,
  VaultKeyMismatchError,
  VaultKeyRetiredError,
  openKeyring,
} from '../../../../src/lib/vault/keyring.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { KEYWRAP_OBJECT_NAME } from '../../../../src/lib/vault/store/types.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function freshVault(key: Buffer, header: VaultHeader = newVaultHeader(new Date(0))): Promise<DirVaultStore> {
  const root = mkdtempSync(join(tmpdir(), 'pan-vault-keyring-'));
  roots.push(root);
  const store = await DirVaultStore.open(join(root, 'vault'));
  expect(await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, header, deriveSubkeys(key)))).toBe('ok');
  return store;
}

/** What a rotation does to the header: re-seal it under `nextKey` with `retiredKey` at the front of the ring. */
async function rewriteHeader(store: DirVaultStore, retiredKey: Buffer, nextKey: Buffer): Promise<void> {
  const current = (await store.readRef(HEADER_REF_NAME))!;
  const header: VaultHeader = {
    ...newVaultHeader(new Date(0)),
    rotatedAt: '2026-09-29T00:00:00.000Z',
    keyRing: [retiredKey.toString('base64')],
  };
  expect(await store.casRef(HEADER_REF_NAME, current.version, await encryptRef(HEADER_REF_NAME, header, deriveSubkeys(nextKey)))).toBe('ok');
}

function machine(label: string): MachineRecord {
  return { v: 1, type: 'machine', environmentId: 'env-1', label, updatedAt: '2026-09-29T00:00:00.000Z' };
}

describe('vault keyring guard (PAN-4333)', () => {
  it('guard.ac1: a casRef after the header changed under another key throws VaultKeyRetiredError and writes nothing', async () => {
    const key = createVaultKey();
    const inner = await freshVault(key);
    const { store, keys } = await openKeyring(inner, key, { backend: 'dir:/mnt/vault' });
    const name = refName('machine', 'env-1', keys.K_ref);
    expect(await store.casRef(name, null, await encryptRef(name, machine('before'), keys))).toBe('ok');
    const before = (await inner.readRef(name))!;

    await rewriteHeader(inner, key, createVaultKey());

    await expect(store.casRef(name, before.version, await encryptRef(name, machine('after'), keys)))
      .rejects.toBeInstanceOf(VaultKeyRetiredError);
    await expect(store.casRefs([{ name, expectedVersion: before.version, value: await encryptRef(name, machine('after'), keys) }]))
      .rejects.toThrow("This machine's vault key was retired by a key rotation. Run: pan vault join dir:/mnt/vault with the new recovery phrase or passphrase.");
    const after = (await inner.readRef(name))!;
    expect(after.version).toBe(before.version);
    expect(Buffer.from(after.value).equals(Buffer.from(before.value))).toBe(true);
    // A brand-new ref is refused too, and never created.
    const fresh = refName('machine', 'env-2', keys.K_ref);
    await expect(store.casRef(fresh, null, await encryptRef(fresh, machine('new'), keys))).rejects.toBeInstanceOf(VaultKeyRetiredError);
    expect(await inner.readRef(fresh)).toBeNull();
  });

  it('guard.ac2: refresh throws VaultKeyRetiredError once the header no longer opens', async () => {
    const key = createVaultKey();
    const inner = await freshVault(key);
    const { store } = await openKeyring(inner, key);
    await expect(store.refresh()).resolves.toBeUndefined();
    await rewriteHeader(inner, key, createVaultKey());
    await expect(store.refresh()).rejects.toBeInstanceOf(VaultKeyRetiredError);
    await expect(store.refresh()).rejects.toThrow('Run: pan vault join <backend> with the new recovery phrase or passphrase.');
  });

  it('guard.ac3: putSlot on a retired key throws and leaves keywrap/v1 unchanged', async () => {
    const key = createVaultKey();
    const inner = await freshVault(key);
    const { store } = await openKeyring(inner, key);
    await store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrap-of-current-key'));
    expect(Buffer.from((await inner.getObject(KEYWRAP_OBJECT_NAME))!).toString()).toBe('wrap-of-current-key');

    await rewriteHeader(inner, key, createVaultKey());
    await inner.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrap-of-new-key'));

    await expect(store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrap-of-retired-key'))).rejects.toBeInstanceOf(VaultKeyRetiredError);
    await expect(store.putSlot(KEYWRAP_OBJECT_NAME, null)).rejects.toBeInstanceOf(VaultKeyRetiredError);
    expect(Buffer.from((await inner.getObject(KEYWRAP_OBJECT_NAME))!).toString()).toBe('wrap-of-new-key');
  });

  it('guard.ac4: openKeyring loads keyRing entries into keys.previous', async () => {
    const key = createVaultKey();
    const retired = [createVaultKey(), createVaultKey()];
    const header: VaultHeader = {
      ...newVaultHeader(new Date(0)),
      rotatedAt: '2026-09-29T00:00:00.000Z',
      keyRing: retired.map((entry) => entry.toString('base64')),
    };
    const inner = await freshVault(key, header);
    const opened = await openKeyring(inner, key);
    expect(opened.keys.previous).toEqual(retired.map((entry) => deriveSubkeys(entry)));
    expect(opened.keys.K_enc.equals(deriveSubkeys(key).K_enc)).toBe(true);
    expect(opened.rotatedAt).toBe('2026-09-29T00:00:00.000Z');
    expect(opened.headerVersion).toBe((await inner.readRef(HEADER_REF_NAME))!.version);
    expect(opened.store).toBeInstanceOf(KeyGuardedStore);

    const plain = await openKeyring(await freshVault(key), key);
    expect(plain.keys.previous).toEqual([]);
    expect(plain.rotatedAt).toBeNull();
  });

  it('openKeyring throws VaultKeyMismatchError when the header is absent or sealed under another key', async () => {
    const key = createVaultKey();
    const root = mkdtempSync(join(tmpdir(), 'pan-vault-keyring-'));
    roots.push(root);
    const empty = await DirVaultStore.open(join(root, 'vault'));
    await expect(openKeyring(empty, key)).rejects.toBeInstanceOf(VaultKeyMismatchError);
    await expect(openKeyring(await freshVault(createVaultKey()), key)).rejects.toBeInstanceOf(VaultKeyMismatchError);
    // A ring key is not the current key: it does not open the vault.
    const rotated = await freshVault(key);
    const next = createVaultKey();
    await rewriteHeader(rotated, key, next);
    await expect(openKeyring(rotated, key)).rejects.toBeInstanceOf(VaultKeyMismatchError);
    expect((await openKeyring(rotated, next)).keys.previous).toEqual([deriveSubkeys(key)]);
  });

  it('guard.ac5: casRef on a current header writes normally', async () => {
    const key = createVaultKey();
    const inner = await freshVault(key);
    const { store, keys, headerVersion } = await openKeyring(inner, key);
    const name = refName('machine', 'env-1', keys.K_ref);
    const value = await encryptRef(name, machine('laptop'), keys);
    expect(await store.casRef(name, null, value)).toBe('ok');
    expect(Buffer.from((await store.readRef(name))!.value).equals(Buffer.from(value))).toBe(true);
    // The header assert is never written.
    expect((await inner.readRef(HEADER_REF_NAME))!.version).toBe(headerVersion);
    // An ordinary stale version is a plain conflict, not a retired key.
    expect(await store.casRef(name, null, value)).toBe('conflict');
    expect(await store.casRef(name, 'stale', value)).toBe('conflict');
    expect((await store.listRefs('m/')).map((ref) => ref.name)).toEqual([name]);
  });

  it('a header rewritten under the same key is adopted: the ring reloads in place and writes go on', async () => {
    const key = createVaultKey();
    const inner = await freshVault(key);
    const { store, keys } = await openKeyring(inner, key);
    const older = createVaultKey();
    const current = (await inner.readRef(HEADER_REF_NAME))!;
    const header: VaultHeader = { ...newVaultHeader(new Date(0)), keyRing: [older.toString('base64')] };
    await inner.casRef(HEADER_REF_NAME, current.version, await encryptRef(HEADER_REF_NAME, header, keys));

    await expect(store.refresh()).resolves.toBeUndefined();
    expect(keys.previous).toEqual([deriveSubkeys(older)]);
    const name = refName('machine', 'env-1', keys.K_ref);
    expect(await store.casRef(name, null, await encryptRef(name, machine('laptop'), keys))).toBe('ok');
  });
});
