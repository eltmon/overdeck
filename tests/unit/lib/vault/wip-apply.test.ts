import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Fixture, git } from '../../cli/vault/helpers.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { applyWipSnapshot, applyWipSnapshotInWorktree, findLatestWip, type CapturedWip } from '../../../../src/lib/vault/wip-apply.js';
import { captureWip } from '../../../../src/lib/vault/wip-capture.js';
import type { SessionRecord } from '../../../../src/lib/vault/format.js';

const VAULT_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const keys = deriveSubkeys(createVaultKey());
// Excluded from the tree comparison: git metadata and the one plain ignored file.
const EXCLUDED = new Set(['.git', 'plain.log']);

/** relative path → sha256 + executable bit, for every file outside `.git` and the ignored file. */
function snapshotTree(root: string, dir = root): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (dir === root && EXCLUDED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, snapshotTree(root, path));
    else {
      const exec = (statSync(path).mode & 0o111) !== 0 ? 'x' : '-';
      out[relative(root, path)] = `${exec}${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
    }
  }
  return out;
}

function indexHash(repo: string): string {
  const index = resolve(repo, git(repo, 'rev-parse', '--git-path', 'index').trim());
  return createHash('sha256').update(readFileSync(index)).digest('hex');
}

function status(repo: string): string {
  return git(repo, '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all');
}

describe('applyWipSnapshot', () => {
  let fixture: Fixture;
  let bare: string;
  let a: string;
  let store: DirVaultStore;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fixture = new Fixture();
    fixture.useMachine('a');
    for (const name of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
      saved[name] = process.env[name];
      process.env[name] = '/dev/null';
    }
    bare = fixture.bareRepo();
    git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    a = join(fixture.root, 'a');
    git(fixture.root, 'init', '-q', '-b', 'main', a);
    configure(a);
    writeFileSync(join(a, '.gitignore'), '*.log\n');
    writeFileSync(join(a, 'mod.txt'), 'one\n');
    writeFileSync(join(a, 'del.txt'), 'delete me\n');
    git(a, 'add', '-A');
    git(a, 'commit', '-q', '-m', 'pushed');
    git(a, 'remote', 'add', 'origin', bare);
    git(a, 'push', '-q', '-u', 'origin', 'main');
    store = await DirVaultStore.open(join(fixture.root, 'vault'));
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fixture.cleanup();
  });

  function configure(repo: string): void {
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.invalid');
  }

  function clone(name: string): string {
    const dir = join(fixture.root, name);
    git(fixture.root, 'clone', '-q', bare, dir);
    configure(dir);
    return dir;
  }

  function makeDirty(): void {
    writeFileSync(join(a, 'unpushed.txt'), 'local commit\n');
    git(a, 'add', 'unpushed.txt');
    git(a, 'commit', '-q', '-m', 'unpushed');
    writeFileSync(join(a, 'forced.log'), 'tracked though ignored\n');
    git(a, 'add', '-f', 'forced.log');
    writeFileSync(join(a, 'staged.txt'), 'staged\n');
    git(a, 'add', 'staged.txt');
    writeFileSync(join(a, 'mod.txt'), 'one\ntwo\n');
    writeFileSync(join(a, 'untracked.txt'), 'untracked\n');
    writeFileSync(join(a, 'run.sh'), '#!/bin/sh\necho hi\n');
    chmodSync(join(a, 'run.sh'), 0o755);
    unlinkSync(join(a, 'del.txt'));
    writeFileSync(join(a, 'bin.dat'), randomBytes(4096));
    writeFileSync(join(a, 'plain.log'), 'ignored\n');
  }

  async function captureA(): Promise<CapturedWip> {
    const result = await captureWip({
      cwd: a, vaultId: VAULT_ID, mode: 'force', previous: null, store, keys,
      maxBytes: 50 * 1024 * 1024, now: () => new Date('2026-09-29T10:00:00Z'),
    });
    if (result.status !== 'captured') throw new Error(`expected captured, got ${JSON.stringify(result)}`);
    return result.wip;
  }

  function apply(cwd: string, wip: CapturedWip) {
    return applyWipSnapshot({ cwd, vaultId: VAULT_ID, wip, store, keys });
  }

  it('recreates A\'s working tree in a clean clone, unstaged, at A\'s HEAD', async () => {
    const b = clone('b');
    makeDirty();
    const wip = await captureA();
    const result = await apply(b, wip);
    expect(result).toEqual({ status: 'applied', cwd: b, head: wip.base, branch: 'main' });
    expect(snapshotTree(b)).toEqual(snapshotTree(a));
    expect(git(b, 'rev-parse', 'HEAD').trim()).toBe(git(a, 'rev-parse', 'HEAD').trim());
    expect(git(b, 'log', '-1', '--format=%s').trim()).toBe('unpushed');
    expect(existsSync(join(b, 'del.txt'))).toBe(false);
    expect(existsSync(join(b, 'plain.log'))).toBe(false);
    git(b, 'diff', '--cached', '--quiet');
    expect(git(b, 'for-each-ref', 'refs/overdeck/')).toBe('');
  }, 30_000);

  it('refuses a dirty checkout without changing it', async () => {
    const b = clone('b');
    makeDirty();
    const wip = await captureA();
    writeFileSync(join(b, 'mine.txt'), 'local work\n');
    const statusBefore = status(b);
    const indexBefore = indexHash(b);
    expect(await apply(b, wip)).toEqual({ status: 'dirty', cwd: b });
    expect(status(b)).toBe(statusBefore);
    expect(indexHash(b)).toBe(indexBefore);
    expect(git(b, 'for-each-ref', 'refs/overdeck/')).toBe('');
  }, 30_000);

  it('leaves a diverged local branch alone and detaches at the base', async () => {
    const b = clone('b');
    writeFileSync(join(b, 'b-only.txt'), 'b\n');
    git(b, 'add', 'b-only.txt');
    git(b, 'commit', '-q', '-m', 'b only');
    const bTip = git(b, 'rev-parse', 'main').trim();
    makeDirty();
    const wip = await captureA();
    const result = await apply(b, wip);
    expect(result).toMatchObject({ status: 'applied', head: wip.base, branch: null });
    expect((result as { note?: string }).note).toContain('Local branch main has commits the snapshot lacks');
    expect(git(b, 'rev-parse', 'main').trim()).toBe(bTip);
    expect(snapshotTree(b)).toEqual(snapshotTree(a));
  }, 30_000);

  it('fails on a tampered part and leaves B unchanged', async () => {
    const b = clone('b');
    makeDirty();
    const wip = await captureA();
    const id = wip.objects[0]!;
    const path = join(fixture.root, 'vault', 'objects', id.slice(0, 2), id);
    const bytes = readFileSync(path);
    bytes[bytes.length >> 1] ^= 0x01;
    writeFileSync(path, bytes);
    const headBefore = git(b, 'rev-parse', 'HEAD').trim();
    const result = await apply(b, wip);
    expect(result.status).toBe('failed');
    expect((result as { reason: string }).reason).toContain('code snapshot failed authentication');
    expect(git(b, 'rev-parse', 'HEAD').trim()).toBe(headBefore);
    expect(status(b)).toBe('');
  }, 30_000);

  it('fetches origin before verifying, so a clone that is behind still applies', async () => {
    const b = clone('b');
    writeFileSync(join(a, 'second.txt'), 'pushed later\n');
    git(a, 'add', 'second.txt');
    git(a, 'commit', '-q', '-m', 'second pushed');
    git(a, 'push', '-q', 'origin', 'main');
    makeDirty();
    const wip = await captureA();
    const result = await apply(b, wip);
    expect(result).toMatchObject({ status: 'applied', head: wip.base, branch: 'main' });
    expect(snapshotTree(b)).toEqual(snapshotTree(a));
  }, 30_000);

  it('creates a missing branch at the base', async () => {
    git(a, 'switch', '-q', '-c', 'topic');
    makeDirty();
    const wip = await captureA();
    expect(wip.branch).toBe('topic');
    const b = clone('b');
    expect(await apply(b, wip)).toMatchObject({ status: 'applied', head: wip.base, branch: 'topic' });
  }, 30_000);

  it('applies into a new worktree without touching the dirty checkout', async () => {
    const b = clone('b');
    makeDirty();
    const wip = await captureA();
    writeFileSync(join(b, 'mine.txt'), 'local work\n');
    const statusBefore = status(b);
    const indexBefore = indexHash(b);
    const worktreeDir = join(fixture.root, 'b-vault');
    const result = await applyWipSnapshotInWorktree({ repoCwd: b, worktreeDir, vaultId: VAULT_ID, wip, store, keys });
    expect(result).toMatchObject({ status: 'applied', cwd: worktreeDir, head: wip.base, branch: null });
    expect((result as { note?: string }).note).toContain('checked out in another worktree');
    expect(status(b)).toBe(statusBefore);
    expect(indexHash(b)).toBe(indexBefore);
    expect(git(b, 'stash', 'list')).toBe('');
    expect(snapshotTree(worktreeDir)).toEqual(snapshotTree(a));
    expect(git(b, 'for-each-ref', 'refs/overdeck/')).toBe('');
  }, 30_000);

  it('findLatestWip reads the newest settlement with a wip entry', () => {
    const wip: CapturedWip = { base: 'b', branch: null, tree: 't', objects: ['o'], bytes: 1, at: 'x' };
    const record = { settlements: [{ at: '1', chunk: 'c', turn: 1, lines: 1, cwdState: null, wip }, { at: '2', chunk: 'c', turn: 2, lines: 2, cwdState: null }] };
    expect(findLatestWip(record as unknown as SessionRecord)).toEqual(wip);
  });
});
