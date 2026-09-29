import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitVaultStore, blobSha, initGitVault } from '../../../../../src/lib/vault/store/git.js';
import { KEYWRAP_OBJECT_NAME, VAULT_FORMAT_MARKER, VaultOfflineError } from '../../../../../src/lib/vault/store/types.js';
import { runVaultStoreContract } from './contract.js';

const roots: string[] = [];

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
}

function bareRepo(): string {
  const dir = join(tmp('pan-vault-bare-'), 'remote.git');
  git(tmpdir(), 'init', '--quiet', '--bare', dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// ac1: the git backend passes every contract case against a fresh bare remote.
runVaultStoreContract('git', () => initGitVault(bareRepo(), join(tmp('pan-vault-clone-'), 'git')));

describe('GitVaultStore', () => {
  it('initGitVault on an empty remote pushes the marker as the first commit of main', async () => {
    const remote = bareRepo();
    const clone = join(tmp('pan-vault-clone-'), 'git');
    await initGitVault(remote, clone);
    expect(git(remote, 'cat-file', '-p', 'main:VAULT-FORMAT')).toBe(VAULT_FORMAT_MARKER);
    expect(git(remote, 'rev-list', '--count', 'main').trim()).toBe('1');
    await expect(GitVaultStore.open(clone)).resolves.toBeInstanceOf(GitVaultStore);
    // A second machine can join the same remote.
    const other = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    expect(other.cloneDir).not.toBe(clone);
  });

  it('ac1: the CAS race across two clones yields exactly one ok', async () => {
    const remote = bareRepo();
    const a = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const b = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const name = 'r/' + 'c'.repeat(40);
    expect(await a.casRef(name, null, Buffer.from('base'))).toBe('ok');
    await b.refresh();
    const version = (await b.readRef(name))!.version;
    expect(version).toBe(blobSha(Buffer.from('base')));

    const results = await Promise.all([
      a.casRef(name, version, Buffer.from('from-a')),
      b.casRef(name, version, Buffer.from('from-b')),
    ]);
    expect(results.sort()).toEqual(['conflict', 'ok']);
    const remoteValue = git(remote, 'cat-file', '-p', `main:refs/r/${'c'.repeat(40)}`);
    expect(['from-a', 'from-b']).toContain(remoteValue);
    await a.refresh();
    await b.refresh();
    expect(Buffer.from((await a.readRef(name))!.value).toString()).toBe(remoteValue);
    expect(Buffer.from((await b.readRef(name))!.value).toString()).toBe(remoteValue);
    // Both clones sit exactly on origin/main: no local commit outlived the race.
    for (const store of [a, b]) {
      expect(git(store.cloneDir, 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');
    }
  });

  it('a batch of three valued ops adds exactly one commit to origin/main', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const names = ['r/' + 'a'.repeat(40), 'm/' + 'b'.repeat(40), 'h/header'];
    expect(await store.casRef(names[0]!, null, Buffer.from('a1'))).toBe('ok');
    expect(git(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('vault: settle');
    const before = Number(git(remote, 'rev-list', '--count', 'main').trim());

    expect(await store.casRefs([
      { name: names[0]!, expectedVersion: blobSha(Buffer.from('a1')), value: Buffer.from('a2') },
      { name: names[1]!, expectedVersion: null, value: Buffer.from('b1') },
      { name: names[2]!, expectedVersion: null, value: Buffer.from('h1') },
    ])).toBe('ok');

    expect(Number(git(remote, 'rev-list', '--count', 'main').trim())).toBe(before + 1);
    expect(git(store.cloneDir, 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');
    expect(git(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('vault: batch');
    expect(git(remote, 'show', '--name-only', '--format=', 'main').trim().split('\n').sort()).toEqual([
      'refs/h/header',
      `refs/m/${'b'.repeat(40)}`,
      `refs/r/${'a'.repeat(40)}`,
    ]);
    expect(git(remote, 'cat-file', '-p', `main:refs/r/${'a'.repeat(40)}`)).toBe('a2');
  });

  it('a stale op in a git batch leaves origin/main and the clone untouched', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const name = 'r/' + 'a'.repeat(40);
    await store.casRef(name, null, Buffer.from('a1'));
    const head = git(remote, 'rev-parse', 'main').trim();
    expect(await store.casRefs([
      { name: 'm/' + 'b'.repeat(40), expectedVersion: null, value: Buffer.from('b1') },
      { name, expectedVersion: 'stale', value: Buffer.from('a2') },
    ])).toBe('conflict');
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(head);
    expect(git(store.cloneDir, 'status', '--porcelain').trim()).toBe('');
  });

  it('objects put on one clone reach the other after a casRef and refresh', async () => {
    const remote = bareRepo();
    const a = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const b = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const id = 'ab' + 'e'.repeat(38);
    await a.putObjects([{ id, bytes: Buffer.from('ciphertext') }]);
    expect(await b.getObject(id)).toBeNull();
    await a.casRef('r/' + id, null, Buffer.from('ref'));
    await b.refresh();
    expect(Buffer.from((await b.getObject(id))!).toString()).toBe('ciphertext');
    expect(await b.hasObjects([id])).toEqual(new Set([id]));
    expect((await b.listRefs('r/')).map((ref) => ref.name)).toEqual(['r/' + id]);
  });

  it('ac2: an unreachable remote makes casRef throw VaultOfflineError with no commit ahead of origin/main', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const name = 'r/' + 'd'.repeat(40);
    await store.casRef(name, null, Buffer.from('v1'));
    const before = git(store.cloneDir, 'rev-parse', 'HEAD').trim();

    git(store.cloneDir, 'remote', 'set-url', 'origin', join(tmpdir(), 'pan-vault-does-not-exist', 'nope.git'));
    await store.putObjects([{ id: 'f'.repeat(40), bytes: Buffer.from('pending') }]);
    await expect(store.casRef(name, blobSha(Buffer.from('v1')), Buffer.from('v2'))).rejects.toBeInstanceOf(VaultOfflineError);
    await expect(store.refresh()).rejects.toBeInstanceOf(VaultOfflineError);

    expect(git(store.cloneDir, 'rev-parse', 'HEAD').trim()).toBe(before);
    expect(git(store.cloneDir, 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');
    // The tree still reflects origin/main; the pending object survives untracked for the next attempt.
    expect(Buffer.from((await store.readRef(name))!.value).toString()).toBe('v1');
    expect(existsSync(join(store.cloneDir, 'objects', 'ff', 'f'.repeat(40)))).toBe(true);

    git(store.cloneDir, 'remote', 'set-url', 'origin', remote);
    expect(await store.casRef(name, blobSha(Buffer.from('v1')), Buffer.from('v2'))).toBe('ok');
    expect(git(remote, 'cat-file', '-p', `main:objects/ff/${'f'.repeat(40)}`)).toBe('pending');
  });

  it('ac3: a non-empty remote without VAULT-FORMAT is refused with no commit or push', async () => {
    const remote = bareRepo();
    const seed = join(tmp('pan-vault-seed-'), 'seed');
    git(tmpdir(), 'clone', '--quiet', remote, seed);
    git(seed, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    writeFileSync(join(seed, 'README.md'), 'not a vault\n');
    git(seed, 'add', 'README.md');
    git(seed, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '--quiet', '-m', 'seed');
    git(seed, 'push', '--quiet', '-u', 'origin', 'main');
    const headBefore = git(remote, 'rev-parse', 'main').trim();

    const clone = join(tmp('pan-vault-clone-'), 'git');
    await expect(initGitVault(remote, clone)).rejects.toThrow(/neither empty nor a vault/);
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(headBefore);
    expect(git(remote, 'rev-list', '--count', 'main').trim()).toBe('1');
    expect(existsSync(clone)).toBe(false);
  });

  it('initGitVault refuses a remote that cannot be cloned with VaultOfflineError', async () => {
    const clone = join(tmp('pan-vault-clone-'), 'git');
    await expect(initGitVault(join(tmpdir(), 'pan-vault-does-not-exist', 'x.git'), clone)).rejects.toBeInstanceOf(VaultOfflineError);
    expect(existsSync(clone)).toBe(false);
  });

  it('two processes on ONE clone: concurrent casRefs all land, none is a phantom conflict', async () => {
    const remote = bareRepo();
    const cloneDir = join(tmp('pan-vault-clone-'), 'git');
    const a = await initGitVault(remote, cloneDir);
    const b = new GitVaultStore(cloneDir); // a second process sharing the clone
    const refA = 'r/' + 'a'.repeat(40);
    const refB = 'r/' + 'b'.repeat(40);
    let versionA: string | null = null;
    let versionB: string | null = null;
    for (let round = 0; round < 8; round++) {
      const [ra, rb] = await Promise.all([
        a.casRef(refA, versionA, Buffer.from(`a-${round}`)),
        b.casRef(refB, versionB, Buffer.from(`b-${round}`)),
      ]);
      expect([ra, rb]).toEqual(['ok', 'ok']);
      await a.refresh();
      versionA = (await a.readRef(refA))!.version;
      versionB = (await a.readRef(refB))!.version;
      expect(git(remote, 'cat-file', '-p', `main:refs/r/${'a'.repeat(40)}`)).toBe(`a-${round}`);
      expect(git(remote, 'cat-file', '-p', `main:refs/r/${'b'.repeat(40)}`)).toBe(`b-${round}`);
    }
    expect(git(cloneDir, 'status', '--porcelain').trim()).toBe('');
    expect(existsSync(`${cloneDir}.lock`)).toBe(false);
  });

  it('a hook-declined push is offline, not a conflict, and the unpushed ref file does not linger', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const hook = join(remote, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho declined >&2\nexit 1\n', { mode: 0o755 });
    const name = 'r/' + 'e'.repeat(40);
    await expect(store.casRef(name, null, Buffer.from('new-record'))).rejects.toBeInstanceOf(VaultOfflineError);
    expect(existsSync(join(store.cloneDir, 'refs', 'r', 'e'.repeat(40)))).toBe(false);
    expect(git(store.cloneDir, 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');
    rmSync(hook);
    expect(await store.casRef(name, null, Buffer.from('new-record'))).toBe('ok');
    expect(git(remote, 'cat-file', '-p', `main:refs/r/${'e'.repeat(40)}`)).toBe('new-record');
  });

  it('retrying after a failed push with a re-encoded chunk (same id, new bytes) succeeds', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const id = 'ab' + 'c'.repeat(38);
    git(store.cloneDir, 'remote', 'set-url', 'origin', join(tmpdir(), 'pan-vault-does-not-exist', 'nope.git'));
    await store.putObjects([{ id, bytes: Buffer.from('nonce-1') }]);
    await expect(store.casRef('r/' + id, null, Buffer.from('ref'))).rejects.toBeInstanceOf(VaultOfflineError);
    git(store.cloneDir, 'remote', 'set-url', 'origin', remote);
    await expect(store.putObjects([{ id, bytes: Buffer.from('nonce-2') }])).resolves.toBeUndefined();
    expect(await store.casRef('r/' + id, null, Buffer.from('ref'))).toBe('ok');
    expect(git(remote, 'cat-file', '-p', `main:objects/ab/${id}`)).toBe('nonce-1');
  });

  it('store-slot.ac3: putSlot publishes to the remote and a second clone reads the write and the delete', async () => {
    const remote = bareRepo();
    const a = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const b = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    await a.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrapped-1'));
    expect(git(remote, 'cat-file', '-p', 'main:objects/keywrap/v1')).toBe('wrapped-1');
    await b.refresh();
    expect(Buffer.from((await b.getObject(KEYWRAP_OBJECT_NAME))!).toString()).toBe('wrapped-1');

    // A third clone made after the write sees it straight away.
    const c = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    expect(Buffer.from((await c.getObject(KEYWRAP_OBJECT_NAME))!).toString()).toBe('wrapped-1');

    // Last write wins from either clone.
    await b.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrapped-2'));
    await a.putSlot(KEYWRAP_OBJECT_NAME, null);
    expect(() => git(remote, 'cat-file', '-e', 'main:objects/keywrap/v1')).toThrow();
    await b.refresh();
    expect(await b.getObject(KEYWRAP_OBJECT_NAME)).toBeNull();
    for (const store of [a, b]) {
      expect(git(store.cloneDir, 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');
    }
  });

  it('store-slot.ac3: the keywrap commit contains only objects/keywrap/v1 while a content object is pending', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const id = 'ab' + 'f'.repeat(38);
    await store.putObjects([{ id, bytes: Buffer.from('pending-chunk') }]);
    await store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrapped'));
    expect(git(store.cloneDir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('objects/keywrap/v1');
    expect(git(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('vault: keywrap');
    expect(() => git(remote, 'cat-file', '-e', `main:objects/ab/${id}`)).toThrow();
    // The pending object is still there, untracked, for the next settle.
    expect(existsSync(join(store.cloneDir, 'objects', 'ab', id))).toBe(true);
    expect(git(store.cloneDir, 'status', '--porcelain', '--', 'objects/keywrap').trim()).toBe('');
  });

  it('store-slot.ac4: an unreachable remote makes putSlot throw VaultOfflineError and leaves no slot file', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const before = git(store.cloneDir, 'rev-parse', 'HEAD').trim();
    git(store.cloneDir, 'remote', 'set-url', 'origin', join(tmpdir(), 'pan-vault-does-not-exist', 'nope.git'));
    await expect(store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrapped'))).rejects.toBeInstanceOf(VaultOfflineError);
    expect(existsSync(join(store.cloneDir, 'objects', 'keywrap', 'v1'))).toBe(false);
    expect(git(store.cloneDir, 'rev-parse', 'HEAD').trim()).toBe(before);
  });

  it('a hook-declined keywrap push is offline and the new slot file does not linger', async () => {
    const remote = bareRepo();
    const store = await initGitVault(remote, join(tmp('pan-vault-clone-'), 'git'));
    const hook = join(remote, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho declined >&2\nexit 1\n', { mode: 0o755 });
    await expect(store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrapped'))).rejects.toBeInstanceOf(VaultOfflineError);
    expect(existsSync(join(store.cloneDir, 'objects', 'keywrap', 'v1'))).toBe(false);
    expect(git(store.cloneDir, 'rev-list', '--count', 'origin/main..HEAD').trim()).toBe('0');
    rmSync(hook);
    await store.putSlot(KEYWRAP_OBJECT_NAME, Buffer.from('wrapped'));
    expect(git(remote, 'cat-file', '-p', 'main:objects/keywrap/v1')).toBe('wrapped');
  });

  it('blobSha matches git hash-object', () => {
    const bytes = Buffer.from('hello vault\n');
    const dir = tmp('pan-vault-hash-');
    writeFileSync(join(dir, 'f'), bytes);
    expect(blobSha(bytes)).toBe(git(dir, 'hash-object', 'f').trim());
    expect(readFileSync(join(dir, 'f')).equals(bytes)).toBe(true);
  });
});
