import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Fixture, git } from '../../cli/vault/helpers.js';
import { decodeWipParts, type Settlement, type WipSnapshotRef } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { allowSecret } from '../../../../src/lib/vault/secrets.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import {
  WIP_KEEP,
  captureWip,
  latestWipEntry,
  pruneWipEntries,
  type CaptureWipOptions,
  type WipMode,
} from '../../../../src/lib/vault/wip-capture.js';

const TOKEN = `ghp_${'abcdefghijklmnopqrstuvwxyz0123456789'}`;
const VAULT_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const T0 = new Date('2026-09-29T10:00:00.000Z');
const keys = deriveSubkeys(createVaultKey());

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The tree an independent temp-index `add -A` (seeded from the real index) produces. */
function independentTree(repo: string, scratch: string): string {
  const index = resolve(repo, git(repo, 'rev-parse', '--git-path', 'index').trim());
  const copy = join(scratch, 'independent-index');
  copyFileSync(index, copy);
  const env = { ...process.env, GIT_INDEX_FILE: copy };
  execFileSync('git', ['add', '-A'], { cwd: repo, env });
  return execFileSync('git', ['write-tree'], { cwd: repo, env, encoding: 'utf8' }).trim();
}

describe('captureWip', () => {
  let fixture: Fixture;
  let repo: string;
  let vaultRoot: string;
  let store: DirVaultStore;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fixture = new Fixture();
    fixture.useMachine('a');
    for (const name of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
      saved[name] = process.env[name];
      process.env[name] = '/dev/null';
    }
    const bare = fixture.bareRepo();
    repo = join(fixture.root, 'repo');
    git(fixture.root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    writeFileSync(join(repo, '.gitignore'), '*.log\n');
    writeFileSync(join(repo, 'mod.txt'), 'one\n');
    writeFileSync(join(repo, 'del.txt'), 'delete me\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'pushed');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    vaultRoot = join(fixture.root, 'vault');
    store = await DirVaultStore.open(vaultRoot);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fixture.cleanup();
  });

  /** One unpushed commit plus staged, unstaged, untracked, deleted, binary, force-added-ignored and ignored changes. */
  function makeDirty(marker = 'no-marker'): void {
    writeFileSync(join(repo, 'unpushed.txt'), 'local commit\n');
    git(repo, 'add', 'unpushed.txt');
    git(repo, 'commit', '-q', '-m', 'unpushed');
    writeFileSync(join(repo, 'forced.log'), 'tracked though ignored\n');
    git(repo, 'add', '-f', 'forced.log');
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    git(repo, 'add', 'staged.txt');
    writeFileSync(join(repo, 'mod.txt'), 'one\ntwo\n');
    writeFileSync(join(repo, 'untracked.txt'), `${marker}\n`);
    unlinkSync(join(repo, 'del.txt'));
    writeFileSync(join(repo, 'bin.dat'), randomBytes(2048));
    writeFileSync(join(repo, 'plain.log'), 'ignored\n');
  }

  function capture(overrides: Partial<CaptureWipOptions> = {}): ReturnType<typeof captureWip> {
    return captureWip({
      cwd: repo,
      vaultId: VAULT_ID,
      mode: 'force',
      previous: null,
      store,
      keys,
      maxBytes: 50 * 1024 * 1024,
      now: () => T0,
      ...overrides,
    });
  }

  function objectFiles(): string[] {
    return listFiles(join(vaultRoot, 'objects'));
  }

  it('captures the working tree and unpushed commits as encrypted parts', async () => {
    makeDirty();
    const expectedTree = independentTree(repo, fixture.root);
    const result = await capture();
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') return;
    expect(result.wip.objects.length).toBeGreaterThanOrEqual(1);
    expect(result.wip.base).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(result.wip.tree).toBe(expectedTree);
    expect(result.wip.branch).toBe('main');
    expect(result.wip.at).toBe(T0.toISOString());

    const parts = await Promise.all(result.wip.objects.map(async (id) => ({ id, bytes: (await store.getObject(id))! })));
    const bundle = await decodeWipParts(parts, keys);
    expect(bundle.length).toBe(result.wip.bytes);
    const bundlePath = join(fixture.root, 'check.bundle');
    writeFileSync(bundlePath, bundle);
    const heads = git(repo, 'bundle', 'list-heads', bundlePath).trim().split('\n');
    expect(heads).toHaveLength(1);
    const wipSha = heads[0]!.split(' ')[0]!;
    expect(git(repo, 'rev-parse', `${wipSha}^{tree}`).trim()).toBe(expectedTree);
    expect(git(repo, 'rev-parse', `${wipSha}^`).trim()).toBe(result.wip.base);
  }, 30_000);

  it('leaves the index file, stash list, status and refs unchanged', async () => {
    makeDirty();
    const status = () => git(repo, '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all');
    const indexPath = resolve(repo, git(repo, 'rev-parse', '--git-path', 'index').trim());
    const statusBefore = status();
    const indexBefore = sha256(indexPath);
    const refsBefore = git(repo, 'for-each-ref');
    expect((await capture()).status).toBe('captured');
    expect(sha256(indexPath)).toBe(indexBefore);
    expect(status()).toBe(statusBefore);
    expect(git(repo, 'stash', 'list')).toBe('');
    expect(git(repo, 'for-each-ref', 'refs/overdeck/')).toBe('');
    expect(git(repo, 'for-each-ref')).toBe(refsBefore);
  }, 30_000);

  it('skips a snapshot holding a secret and writes no object', async () => {
    makeDirty();
    writeFileSync(join(repo, 'secret.ts'), `export const token = '${TOKEN}';\n`);
    const result = await capture();
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.wip).toMatchObject({ skipped: 'secret', reason: '1 secret hit(s)', at: T0.toISOString() });
    expect(result.hits?.[0]).toMatchObject({ file: 'secret.ts', pattern: 'token' });
    expect(JSON.stringify(result)).not.toContain(TOKEN.slice(4));
    expect(objectFiles()).toEqual([]);
  }, 30_000);

  it('skips a bundle over maxBytes and writes no object', async () => {
    makeDirty();
    const result = await capture({ maxBytes: 10 });
    expect(result.status).toBe('skipped');
    if (result.status !== 'skipped') return;
    expect(result.wip.skipped).toBe('too-large');
    expect(result.wip.bytes).toBeGreaterThan(10);
    expect(objectFiles()).toEqual([]);
  }, 30_000);

  it('stores no plaintext content, bundle header or WIP sha in the backend', async () => {
    const marker = randomBytes(16).toString('hex');
    makeDirty(marker);
    const result = await capture();
    expect(result.status).toBe('captured');
    const bundle = await decodeWipParts(
      await Promise.all(
        (result as { wip: { objects: string[] } }).wip.objects.map(async (id) => ({ id, bytes: (await store.getObject(id))! })),
      ),
      keys,
    );
    const bundlePath = join(fixture.root, 'scan.bundle');
    writeFileSync(bundlePath, bundle);
    const wipSha = git(repo, 'bundle', 'list-heads', bundlePath).trim().split(' ')[0]!;
    const needles = ['# v2 git bundle', 'refs/overdeck/wip/', wipSha, marker];
    const files = listFiles(vaultRoot);
    expect(files.some((path) => path.endsWith('VAULT-FORMAT'))).toBe(true);
    for (const path of files) {
      const bytes = readFileSync(path);
      for (const needle of needles) expect(bytes.includes(Buffer.from(needle)), `${needle} in ${path}`).toBe(false);
    }
  }, 30_000);

  it('records a clean, fully pushed checkout as skipped clean without an object', async () => {
    writeFileSync(join(repo, 'plain.log'), 'ignored only\n');
    const result = await capture();
    expect(result).toEqual({
      status: 'skipped',
      wip: {
        skipped: 'clean',
        base: git(repo, 'rev-parse', 'HEAD').trim(),
        tree: git(repo, 'rev-parse', 'HEAD^{tree}').trim(),
        at: T0.toISOString(),
      },
    });
    expect(objectFiles()).toEqual([]);
  }, 30_000);

  it('bundles a clean checkout that has unpushed commits', async () => {
    writeFileSync(join(repo, 'unpushed.txt'), 'local\n');
    git(repo, 'add', 'unpushed.txt');
    git(repo, 'commit', '-q', '-m', 'unpushed');
    expect((await capture()).status).toBe('captured');
  }, 30_000);

  it('builds the WIP commit even when the repo asks for signed commits', async () => {
    makeDirty();
    git(repo, 'config', 'commit.gpgSign', 'true');
    git(repo, 'config', 'gpg.program', 'false');
    expect((await capture()).status).toBe('captured');
  }, 30_000);

  describe('modes', () => {
    it('off captures nothing', async () => {
      expect(await capture({ mode: 'off' })).toEqual({ status: 'off' });
    });

    it('auto within the interval is throttled before any git runs', async () => {
      const previous: WipSnapshotRef = { skipped: 'clean', base: 'b', tree: 't', at: T0.toISOString() };
      const result = await capture({
        cwd: join(fixture.root, 'not-a-repo'),
        mode: 'auto',
        previous,
        now: () => new Date(T0.getTime() + 299_000),
      });
      expect(result).toEqual({ status: 'throttled' });
    });

    it('auto after the interval with the same (base, tree) is unchanged', async () => {
      makeDirty();
      const first = await capture();
      expect(first.status).toBe('captured');
      const second = await capture({
        mode: 'auto',
        previous: (first as { wip: WipSnapshotRef }).wip,
        now: () => new Date(T0.getTime() + 301_000),
      });
      expect(second).toEqual({ status: 'unchanged' });
    }, 30_000);

    it('force retries a secret skip with the same (base, tree) once the line is allowed', async () => {
      makeDirty();
      writeFileSync(join(repo, 'secret.ts'), `export const token = '${TOKEN}';\n`);
      const blocked = await capture();
      expect(blocked.status).toBe('skipped');
      if (blocked.status !== 'skipped') return;
      for (const hit of blocked.hits ?? []) await allowSecret(VAULT_ID, hit.hash);
      const retried = await capture({ previous: blocked.wip });
      expect(retried.status).toBe('captured');
      expect((retried as { wip: { tree: string } }).wip.tree).toBe(blocked.wip.tree);
    }, 30_000);

    it('force with a too-large skip for the same (base, tree) is unchanged', async () => {
      makeDirty();
      const tooLarge = await capture({ maxBytes: 10 });
      expect(tooLarge.status).toBe('skipped');
      const again = await capture({ maxBytes: 10, previous: (tooLarge as { wip: WipSnapshotRef }).wip });
      expect(again).toEqual({ status: 'unchanged' });
    }, 30_000);

    it('a non-repo cwd yields no-git with no entry', async () => {
      const cwd = join(fixture.root, 'not-a-repo');
      mkdirSync(cwd);
      for (const mode of ['auto', 'force'] as WipMode[]) {
        expect(await capture({ cwd, mode })).toEqual({ status: 'no-git' });
      }
      expect(statSync(cwd).isDirectory()).toBe(true);
    });
  });
});

describe('WIP entry bookkeeping', () => {
  function settlement(at: number, wip?: WipSnapshotRef): Settlement {
    return { at: new Date(at).toISOString(), chunk: 'c', turn: at, lines: at, cwdState: null, ...(wip ? { wip } : {}) };
  }
  const captured = (n: number): WipSnapshotRef => ({
    base: `b${n}`, branch: 'main', tree: `t${n}`, objects: [`o${n}`], bytes: n, at: new Date(n).toISOString(),
  });

  it('latestWipEntry returns the newest settlement that has a wip field', () => {
    const skip: WipSnapshotRef = { skipped: 'clean', base: 'b', tree: 't', at: 'x' };
    expect(latestWipEntry([])).toBeNull();
    expect(latestWipEntry([settlement(1, captured(1)), settlement(2, skip), settlement(3)])).toEqual(skip);
  });

  it('pruneWipEntries keeps the newest captured entries and every skip', () => {
    const skip: WipSnapshotRef = { skipped: 'secret', base: 'b', tree: 't', at: 'x' };
    const settlements = [
      settlement(0, skip),
      ...Array.from({ length: WIP_KEEP + 2 }, (_, i) => settlement(i + 1, captured(i + 1))),
      settlement(99),
    ];
    const pruned = pruneWipEntries(settlements);
    expect(pruned).toHaveLength(settlements.length);
    expect(pruned[0]!.wip).toEqual(skip);
    expect(pruned[1]!.wip).toBeUndefined();
    expect(pruned[2]!.wip).toBeUndefined();
    expect(pruned.filter((s) => s.wip && 'objects' in s.wip)).toHaveLength(WIP_KEEP);
    expect(settlements[1]!.wip).toBeDefined();
  });
});
