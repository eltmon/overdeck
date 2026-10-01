/** PAN-4307 WI-1 (D-5): `openVaultContext()` resolves the vault without printing or exiting. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeVaultConfig } from '../../../../src/lib/vault/config.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader, type VaultHeader } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys, saveVaultKey } from '../../../../src/lib/vault/identity.js';
import { VaultKeyRetiredError } from '../../../../src/lib/vault/keyring.js';
import { DIR_BACKEND_PREFIX, openVaultContext } from '../../../../src/lib/vault/open.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import type { VaultStore } from '../../../../src/lib/vault/store/types.js';

describe('openVaultContext (PAN-4307 WI-1)', () => {
  let root: string;
  let overdeckHome: string;
  let backendDir: string;
  let backend: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-open-'));
    overdeckHome = join(root, '.overdeck');
    backendDir = join(root, 'backend');
    backend = `${DIR_BACKEND_PREFIX}${backendDir}`;
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = overdeckHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  /** Set up config + key + header the way `pan vault setup` does, without CLI output. */
  async function setUpVault(): Promise<{ key: Buffer; store: VaultStore }> {
    const key = createVaultKey();
    const keys = deriveSubkeys(key);
    const store = await DirVaultStore.open(backendDir);
    expect(await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), keys))).toBe('ok');
    await saveVaultKey(key);
    await writeVaultConfig({ backend });
    return { key, store };
  }

  it('ac1a: no backend configured returns status off and touches nothing', async () => {
    expect(await openVaultContext()).toEqual({ status: 'off' });
  });

  it('ac1b: a key.next present returns status rotation-pending with the backend', async () => {
    await setUpVault();
    writeFileSync(join(overdeckHome, 'vault', 'key.next'), createVaultKey());
    expect(await openVaultContext()).toEqual({ status: 'rotation-pending', backend });
  });

  it('ac1c: backend configured but the key file is missing returns status key-missing', async () => {
    const store = await DirVaultStore.open(backendDir);
    const keys = deriveSubkeys(createVaultKey());
    expect(await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), keys))).toBe('ok');
    await writeVaultConfig({ backend });
    expect(await openVaultContext()).toEqual({ status: 'key-missing', backend });
  });

  it('ac1d: a key that never opened the header returns status key-mismatch', async () => {
    await setUpVault();
    await saveVaultKey(createVaultKey());
    expect(await openVaultContext()).toEqual({ status: 'key-mismatch', backend });
  });

  it('ac1e/ac2: a valid key returns status open with a store that throws VaultKeyRetiredError after a rotation elsewhere', async () => {
    const { key, store: rawStore } = await setUpVault();

    const opened = await openVaultContext();
    expect(opened.status).toBe('open');
    if (opened.status !== 'open') throw new Error('unreachable');
    expect(opened.vault.rotatedAt).toBeNull();
    expect(opened.vault.keys.previous).toEqual([]);
    expect(opened.vault.config.backend).toBe(backend);

    // Simulate a rotation performed on another machine: the header is re-sealed
    // under a new key, this machine's key retired into its ring.
    const nextKey = createVaultKey();
    const current = (await rawStore.readRef(HEADER_REF_NAME))!;
    const rotated: VaultHeader = { ...newVaultHeader(new Date(0)), rotatedAt: '2026-09-30T00:00:00.000Z', keyRing: [key.toString('base64')] };
    expect(await rawStore.casRef(HEADER_REF_NAME, current.version, await encryptRef(HEADER_REF_NAME, rotated, deriveSubkeys(nextKey)))).toBe('ok');

    await expect(opened.vault.store.casRef('r/whatever', null, new Uint8Array())).rejects.toThrow(VaultKeyRetiredError);
  });

  it('nothing is printed to stdout/stderr across every status', async () => {
    const outSpy = process.stdout.write.bind(process.stdout);
    const errSpy = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stdout.write = ((chunk: string) => { captured.push(String(chunk)); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => { captured.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try {
      await openVaultContext();
      await setUpVault();
      await openVaultContext();
    } finally {
      process.stdout.write = outSpy;
      process.stderr.write = errSpy;
    }
    expect(captured).toEqual([]);
  });
});
