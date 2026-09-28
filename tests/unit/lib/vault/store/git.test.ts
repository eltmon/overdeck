import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitVaultStore, blobSha, initGitVault } from '../../../../../src/lib/vault/store/git.js';
import { VAULT_FORMAT_MARKER, VaultOfflineError } from '../../../../../src/lib/vault/store/types.js';
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
runVaultStoreContract(() => initGitVault(bareRepo(), join(tmp('pan-vault-clone-'), 'git')));

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

  it('blobSha matches git hash-object', () => {
    const bytes = Buffer.from('hello vault\n');
    const dir = tmp('pan-vault-hash-');
    writeFileSync(join(dir, 'f'), bytes);
    expect(blobSha(bytes)).toBe(git(dir, 'hash-object', 'f').trim());
    expect(readFileSync(join(dir, 'f')).equals(bytes)).toBe(true);
  });
});
