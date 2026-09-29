import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DirVaultStore, refVersion } from '../../../../../src/lib/vault/store/dir.js';
import { VAULT_FORMAT_MARKER } from '../../../../../src/lib/vault/store/types.js';
import { runVaultStoreContract } from './contract.js';

const roots: string[] = [];

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pan-vault-dir-'));
  roots.push(root);
  return join(root, 'vault');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ac1: the dir backend passes every contract case.
runVaultStoreContract(() => DirVaultStore.open(freshRoot()));

describe('DirVaultStore layout', () => {
  it('creates the P-3 marker and lays objects and refs out by prefix', async () => {
    const root = freshRoot();
    const store = await DirVaultStore.open(root);
    expect(readFileSync(join(root, 'VAULT-FORMAT'), 'utf8')).toBe(VAULT_FORMAT_MARKER);
    const id = 'ab' + 'c'.repeat(38);
    await store.putObjects([{ id, bytes: Buffer.from('chunk') }]);
    expect(readFileSync(join(root, 'objects', 'ab', id), 'utf8')).toBe('chunk');
    await store.casRef('r/' + id, null, Buffer.from('ref'));
    expect(readFileSync(join(root, 'refs', 'r', id), 'utf8')).toBe('ref');
    expect((await store.readRef('r/' + id))!.version).toBe(refVersion(Buffer.from('ref')));
    expect(readdirSync(join(root, 'refs', 'r'))).toEqual([id]);
    await store.putObjects([{ id: 'keywrap/v1', bytes: Buffer.from('wrapped') }]);
    expect(readFileSync(join(root, 'objects', 'keywrap', 'v1'), 'utf8')).toBe('wrapped');
  });

  it('re-opens an existing vault and refuses a non-empty non-vault or foreign marker', async () => {
    const root = freshRoot();
    await DirVaultStore.open(root);
    await expect(DirVaultStore.open(root)).resolves.toBeInstanceOf(DirVaultStore);

    const junk = freshRoot();
    mkdirSync(junk, { recursive: true });
    writeFileSync(join(junk, 'README'), 'hi');
    await expect(DirVaultStore.open(junk)).rejects.toThrow(/neither empty nor a vault/);

    const foreign = freshRoot();
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'VAULT-FORMAT'), 'overdeck-vault 2\n');
    await expect(DirVaultStore.open(foreign)).rejects.toThrow(/unsupported VAULT-FORMAT/);
  });

  it('rejects malformed ids and ref names before touching the disk', async () => {
    const store = await DirVaultStore.open(freshRoot());
    await expect(store.getObject('../etc/passwd')).rejects.toThrow(/Invalid vault object id/);
    await expect(store.readRef('../x')).rejects.toThrow(/Invalid vault ref name/);
    await expect(store.casRef('r/UPPER', null, Buffer.from('x'))).rejects.toThrow(/Invalid vault ref name/);
  });

  it('refuses to overwrite an object with different bytes', async () => {
    const store = await DirVaultStore.open(freshRoot());
    const id = 'd'.repeat(40);
    await store.putObjects([{ id, bytes: Buffer.from('one') }]);
    await expect(store.putObjects([{ id, bytes: Buffer.from('two') }])).rejects.toThrow(/different bytes/);
    expect(Buffer.from((await store.getObject(id))!).toString()).toBe('one');
  });
});
