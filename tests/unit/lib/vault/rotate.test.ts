import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import {
  HEADER_REF_NAME,
  VaultAuthenticationError,
  decodeChunk,
  decryptRef,
  encryptRef,
  newVaultHeader,
  parseKeyRing,
  readMachineRecord,
  readSessionRecord,
  readVaultHeader,
  refName,
  type MachineRecord,
  type SessionRecord,
} from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys, loadVaultKey, saveVaultKey, vaultKeyPath } from '../../../../src/lib/vault/identity.js';
import { openKeyring } from '../../../../src/lib/vault/keyring.js';
import {
  VaultRotationConflictError,
  clearNextKey,
  loadNextKey,
  nextKeyPath,
  rotateVaultKey,
  saveNextKey,
} from '../../../../src/lib/vault/rotate.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { initGitVault } from '../../../../src/lib/vault/store/git.js';
import { KEYWRAP_OBJECT_NAME, VaultOfflineError, type RefOp, type VaultStore } from '../../../../src/lib/vault/store/types.js';

const AT = '2026-09-29T12:00:00.000Z';
const now = () => new Date(AT);

function user(text: string, cwd: string, sessionId: string): string {
  return JSON.stringify({ type: 'user', sessionId, cwd, message: { role: 'user', content: text } });
}

/** A store that forwards every call to `inner` except the methods in `overrides`. */
function wrapStore(inner: VaultStore, overrides: Partial<VaultStore>): VaultStore {
  return {
    putObjects: (objects) => inner.putObjects(objects),
    getObject: (id) => inner.getObject(id),
    hasObjects: (ids) => inner.hasObjects(ids),
    readRef: (name) => inner.readRef(name),
    casRef: (name, expectedVersion, value) => inner.casRef(name, expectedVersion, value),
    casRefs: (ops) => inner.casRefs(ops),
    listRefs: (prefix) => inner.listRefs(prefix),
    refresh: () => inner.refresh(),
    putSlot: (name, bytes) => inner.putSlot(name, bytes),
    discardUnpublished: () => inner.discardUnpublished(),
    ...overrides,
  };
}

describe('vault key rotation (PAN-4333)', () => {
  let root: string;
  let cwd: string;
  let config: VaultConfig;
  let originalHome: string | undefined;
  let key: Buffer;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-rotate-'));
    cwd = join(root, 'project');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
    key = createVaultKey();
    await saveVaultKey(key);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  /** A vault under `key` with a header, two settled records, one tombstone and this machine's ref. */
  async function seed(store: VaultStore): Promise<{ vaultIds: string[]; lines: string[][]; environmentId: string }> {
    const keys = deriveSubkeys(key);
    expect(await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(new Date(0)), keys))).toBe('ok');
    const vaultIds: string[] = [];
    const lines: string[][] = [];
    for (const [index, sessionId] of ['11111111-2222-4333-8444-555555555555', '66666666-7777-4888-8999-aaaaaaaaaaaa'].entries()) {
      const transcript = [user(`conversation ${index} opening`, cwd, sessionId), user(`conversation ${index} follow-up`, cwd, sessionId)];
      const nativePath = join(root, `${sessionId}.jsonl`);
      writeFileSync(nativePath, `${transcript.join('\n')}\n`);
      const saved = await settle({ nativePath, harness: 'claude-code', store, keys, config });
      expect(saved.verdict).toBe('append');
      vaultIds.push((saved as { vaultId: string }).vaultId);
      lines.push(transcript);
    }
    const tombName = refName('record', 'gone', keys.K_ref);
    await store.casRef(tombName, null, await encryptRef(tombName, { v: 1, type: 'session', vaultId: 'gone', tombstone: true }, keys));
    const me = await ensureEnvironmentIdentity();
    const machine: MachineRecord = { v: 1, type: 'machine', environmentId: me.environmentId, label: me.label, updatedAt: AT };
    const machineName = refName('machine', me.environmentId, keys.K_ref);
    await store.casRef(machineName, null, await encryptRef(machineName, machine, keys));
    return { vaultIds, lines, environmentId: me.environmentId };
  }

  async function recordUnder(store: VaultStore, vaultId: string, vaultKey: Buffer): Promise<SessionRecord> {
    const keys = deriveSubkeys(vaultKey);
    const name = refName('record', vaultId, keys.K_ref);
    return (await readSessionRecord(name, (await store.readRef(name))!.value, keys)) as SessionRecord;
  }

  it("rotate.ac1: after rotation every record and machine is readable under K' at its new name with identical content", async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    const { vaultIds, environmentId } = await seed(store);
    const before = await Promise.all(vaultIds.map((vaultId) => recordUnder(store, vaultId, key)));
    const oldKeys = deriveSubkeys(key);
    const oldMachineName = refName('machine', environmentId, oldKeys.K_ref);
    const machineBefore = await readMachineRecord(oldMachineName, (await store.readRef(oldMachineName))!.value, oldKeys);

    const result = await rotateVaultKey({ store, currentKey: key, now });
    expect(result).toMatchObject({ records: 3, machines: 1, resumed: false, committed: 'now' });
    expect(result.newKey.equals(key)).toBe(false);
    expect((await loadVaultKey())!.equals(result.newKey)).toBe(true);
    expect(statSync(vaultKeyPath()).mode & 0o777).toBe(0o600);

    const newKeys = deriveSubkeys(result.newKey);
    const header = (await readVaultHeader((await store.readRef(HEADER_REF_NAME))!.value, newKeys))!;
    expect(header).toMatchObject({ createdAt: '1970-01-01T00:00:00.000Z', rotatedAt: AT });
    for (const [index, vaultId] of vaultIds.entries()) {
      expect(await recordUnder(store, vaultId, result.newKey)).toEqual(before[index]);
    }
    const tombName = refName('record', 'gone', newKeys.K_ref);
    expect(await readSessionRecord(tombName, (await store.readRef(tombName))!.value, newKeys))
      .toEqual({ v: 1, type: 'session', vaultId: 'gone', tombstone: true });
    const machineName = refName('machine', environmentId, newKeys.K_ref);
    expect(await readMachineRecord(machineName, (await store.readRef(machineName))!.value, newKeys)).toEqual(machineBefore);
    // key.next stays until the CLI has printed the phrase.
    expect((await loadNextKey())!.equals(result.newKey)).toBe(true);
    expect(statSync(nextKeyPath()).mode & 0o777).toBe(0o600);
  });

  it('rotate.ac2: every old name holds a retired marker sealed under K', async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    const { vaultIds, environmentId } = await seed(store);
    const oldKeys = deriveSubkeys(key);
    const oldNames = [
      ...[...vaultIds, 'gone'].map((vaultId) => refName('record', vaultId, oldKeys.K_ref)),
      refName('machine', environmentId, oldKeys.K_ref),
    ];
    const result = await rotateVaultKey({ store, currentKey: key, now });
    const newKeys = deriveSubkeys(result.newKey);
    for (const name of oldNames) {
      const ref = (await store.readRef(name))!;
      expect(await decryptRef(name, ref.value, oldKeys)).toEqual({ v: 1, type: 'retired', at: AT });
      await expect(decryptRef(name, ref.value, newKeys)).rejects.toBeInstanceOf(VaultAuthenticationError);
    }
    const header = (await readVaultHeader((await store.readRef(HEADER_REF_NAME))!.value, newKeys))!;
    expect(header.keyRing).toEqual([key.toString('base64')]);
    await expect(readVaultHeader((await store.readRef(HEADER_REF_NAME))!.value, oldKeys)).rejects.toBeInstanceOf(VaultAuthenticationError);
    expect((await store.listRefs('r/')).length).toBe(6);
    expect((await store.listRefs('m/')).length).toBe(2);

    // A second rotation keeps the whole ring, newest first, and leaves the first rotation's markers alone.
    await clearNextKey();
    const second = await rotateVaultKey({ store, currentKey: result.newKey, now });
    expect(second).toMatchObject({ records: 3, machines: 1, committed: 'now' });
    const ring = parseKeyRing((await readVaultHeader((await store.readRef(HEADER_REF_NAME))!.value, deriveSubkeys(second.newKey)))!);
    expect(ring.map((entry) => entry.toString('base64'))).toEqual([result.newKey.toString('base64'), key.toString('base64')]);
    expect(await decryptRef(oldNames[0]!, (await store.readRef(oldNames[0]!))!.value, oldKeys)).toEqual({ v: 1, type: 'retired', at: AT });
  });

  it('rotate.ac3: a pre-rotation chunk decodes via the ring loaded by openKeyring', async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    const { vaultIds, lines } = await seed(store);
    const chunkId = (await recordUnder(store, vaultIds[0]!, key)).log[0]!;
    const result = await rotateVaultKey({ store, currentKey: key, now });

    const opened = await openKeyring(store, result.newKey);
    expect(opened.rotatedAt).toBe(AT);
    expect(opened.keys.previous).toEqual([deriveSubkeys(key)]);
    const record = await recordUnder(store, vaultIds[0]!, result.newKey);
    expect(record.log[0]).toBe(chunkId);
    const bytes = (await opened.store.getObject(chunkId))!;
    expect((await decodeChunk(bytes, chunkId, opened.keys)).lines).toEqual(lines[0]);
    await expect(decodeChunk(bytes, chunkId, deriveSubkeys(result.newKey))).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it("rotate.ac4: a crash after the commit (throwing from the keywrap putSlot) resumes with the same K' and committed: earlier", async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    await seed(store);
    await store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrap-of-old-key'));
    const crashing = wrapStore(store, { putSlot: async () => { throw new Error('power cut'); } });
    await expect(rotateVaultKey({ store: crashing, currentKey: key, keywrap: Buffer.from('wrap-of-new-key'), now })).rejects.toThrow('power cut');

    const pending = (await loadNextKey())!;
    expect((await loadVaultKey())!.equals(key)).toBe(true);
    expect(await readVaultHeader((await store.readRef(HEADER_REF_NAME))!.value, deriveSubkeys(pending))).not.toBeNull();
    const refsAfterCommit = await store.listRefs('');

    const resumed = await rotateVaultKey({ store, currentKey: key, keywrap: Buffer.from('wrap-of-new-key'), now });
    expect(resumed).toMatchObject({ records: 3, machines: 1, resumed: true, committed: 'earlier' });
    expect(resumed.newKey.equals(pending)).toBe(true);
    expect((await loadVaultKey())!.equals(pending)).toBe(true);
    expect(Buffer.from((await store.getObject(KEYWRAP_OBJECT_NAME))!).toString()).toBe('wrap-of-new-key');
    expect(await store.listRefs('')).toEqual(refsAfterCommit);

    // A crash after the key file was replaced finishes the same way.
    const again = await rotateVaultKey({ store, currentKey: (await loadVaultKey())!, keywrap: null, now });
    expect(again).toMatchObject({ resumed: true, committed: 'earlier' });
    expect(again.newKey.equals(pending)).toBe(true);
    expect(await store.getObject(KEYWRAP_OBJECT_NAME)).toBeNull();
    expect(await store.listRefs('')).toEqual(refsAfterCommit);
  });

  it('rotate.ac5: a conflicting write between read and commit is retried and the final vault includes it', async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    await seed(store);
    const oldKeys = deriveSubkeys(key);
    const lateName = refName('record', 'late', oldKeys.K_ref);
    const late = { v: 1 as const, type: 'session' as const, vaultId: 'late', tombstone: true as const };
    const batches: Array<ReadonlyArray<RefOp>> = [];
    const racing = wrapStore(store, {
      casRefs: async (ops) => {
        batches.push(ops);
        if (batches.length > 1) return store.casRefs(ops);
        // Another machine settles a new record just before the batch lands.
        expect(await store.casRef(lateName, null, await encryptRef(lateName, late, oldKeys))).toBe('ok');
        return 'conflict';
      },
    });
    const result = await rotateVaultKey({ store: racing, currentKey: key, now });
    expect(result).toMatchObject({ records: 4, machines: 1, committed: 'now' });
    expect(batches).toHaveLength(2);
    expect(batches[1]!.length).toBe(batches[0]!.length + 2);
    const newKeys = deriveSubkeys(result.newKey);
    const newName = refName('record', 'late', newKeys.K_ref);
    expect(await readSessionRecord(newName, (await store.readRef(newName))!.value, newKeys)).toEqual(late);
    expect(await decryptRef(lateName, (await store.readRef(lateName))!.value, oldKeys)).toMatchObject({ type: 'retired' });
  });

  it('gives up after maxAttempts conflicts, keeps key.next, and leaves the vault and the key file as they were', async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    await seed(store);
    const refsBefore = await store.listRefs('');
    let calls = 0;
    const busy = wrapStore(store, { casRefs: async () => { calls++; return 'conflict'; } });
    const failure = await rotateVaultKey({ store: busy, currentKey: key, now, maxAttempts: 3 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VaultRotationConflictError);
    expect((failure as Error).message).toBe('Another machine kept writing to the vault. Stop pan vault on your other machines and run pan vault rotate-key again.');
    expect(calls).toBe(3);
    expect(await loadNextKey()).not.toBeNull();
    expect((await loadVaultKey())!.equals(key)).toBe(true);
    expect(await store.listRefs('')).toEqual(refsBefore);
  });

  it('an unreachable backend propagates VaultOfflineError with key.next kept; a key that opens nothing is refused', async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    await seed(store);
    const offline = wrapStore(store, { casRefs: async () => { throw new VaultOfflineError('remote down'); } });
    await expect(rotateVaultKey({ store: offline, currentKey: key, now })).rejects.toBeInstanceOf(VaultOfflineError);
    const pending = (await loadNextKey())!;
    expect((await loadVaultKey())!.equals(key)).toBe(true);

    await expect(rotateVaultKey({ store, currentKey: createVaultKey(), now }))
      .rejects.toThrow('The vault key on this machine does not open the vault; nothing was rotated.');
    expect((await loadNextKey())!.equals(pending)).toBe(true);
    expect(await readVaultHeader((await store.readRef(HEADER_REF_NAME))!.value, deriveSubkeys(key))).not.toBeNull();
  });

  it('refs the current key cannot open, and values stored under a foreign name, are left behind', async () => {
    const store = await DirVaultStore.open(join(root, 'backend'));
    await seed(store);
    const oldKeys = deriveSubkeys(key);
    const junk = `r/${'0'.repeat(40)}`;
    await store.casRef(junk, null, await encryptRef(junk, { v: 1, type: 'session', vaultId: 'junk', tombstone: true }, deriveSubkeys(createVaultKey())));
    const misplaced = `r/${'1'.repeat(40)}`;
    await store.casRef(misplaced, null, await encryptRef(misplaced, { v: 1, type: 'session', vaultId: 'gone', tombstone: true }, oldKeys));
    const task = refName('record', 'task-1', oldKeys.K_ref);
    await store.casRef(task, null, await encryptRef(task, { v: 1, type: 'task', vaultId: 'task-1' } as never, oldKeys));
    const untouched = await Promise.all([junk, misplaced, task].map(async (name) => (await store.readRef(name))!.version));

    const result = await rotateVaultKey({ store, currentKey: key, now });
    expect(result).toMatchObject({ records: 3, machines: 1 });
    expect(await Promise.all([junk, misplaced, task].map(async (name) => (await store.readRef(name))!.version))).toEqual(untouched);
  });

  it('key.next helpers: save is 0600, load rejects a wrong length, clear ignores a missing file', async () => {
    expect(await loadNextKey()).toBeNull();
    await expect(clearNextKey()).resolves.toBeUndefined();
    const next = createVaultKey();
    expect(await saveNextKey(next)).toBe(nextKeyPath());
    expect(nextKeyPath()).toBe(join(root, '.overdeck', 'vault', 'key.next'));
    expect(statSync(nextKeyPath()).mode & 0o777).toBe(0o600);
    expect(readFileSync(nextKeyPath()).equals(next)).toBe(true);
    await expect(saveNextKey(Buffer.alloc(31))).rejects.toThrow(/must be 32 bytes/);
    writeFileSync(nextKeyPath(), Buffer.alloc(31));
    await expect(loadNextKey()).rejects.toThrow(/must be 32 bytes, got 31/);
    await clearNextKey();
    expect(existsSync(nextKeyPath())).toBe(false);
  });

  it('rotate.ac6: the rotation adds exactly one commit to the bare remote', async () => {
    const git = (gitCwd: string, ...args: string[]): string => execFileSync('git', args, {
      cwd: gitCwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    });
    const remote = join(root, 'remote.git');
    git(root, 'init', '--quiet', '--bare', remote);
    const store = await initGitVault(remote, join(root, 'clone', 'git'));
    const { vaultIds, lines } = await seed(store);
    // An object no settle published: the rotation commit must not carry it.
    const stray = 'ab' + 'c'.repeat(38);
    await store.putObjects([{ id: stray, bytes: Buffer.from('sealed under the old key') }]);
    const before = Number(git(remote, 'rev-list', '--count', 'main').trim());

    const result = await rotateVaultKey({ store, currentKey: key, now });
    expect(result).toMatchObject({ records: 3, machines: 1, committed: 'now' });
    expect(Number(git(remote, 'rev-list', '--count', 'main').trim())).toBe(before + 1);
    expect(git(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('vault: batch');
    const changed = git(remote, 'show', '--name-only', '--format=', 'main').trim().split('\n');
    expect(changed).toHaveLength(9);
    expect(changed.every((path) => path.startsWith('refs/'))).toBe(true);
    expect(await store.hasObjects([stray])).toEqual(new Set());

    // A second machine that clones afterwards reads everything with the new key.
    const other = await initGitVault(remote, join(root, 'clone-b', 'git'));
    const opened = await openKeyring(other, result.newKey);
    const record = await recordUnder(other, vaultIds[1]!, result.newKey);
    const chunk = await decodeChunk((await other.getObject(record.log[0]!))!, record.log[0]!, opened.keys);
    expect(chunk.lines).toEqual(lines[1]);
  });
});
