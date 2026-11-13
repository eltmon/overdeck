import { mkdir, mkdtemp, readFile as fsReadFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import { gitStage, gitStatus } from '../git.js';
import type { ExplorerRoot } from '../roots.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function repo(files: Record<string, string>): Promise<FixtureRepo> {
  const r = await makeFixtureRepo(files);
  r.dir = await realpath(r.dir);
  cleanups.push(r.cleanup);
  return r;
}

function rootAt(absPath: string, kind: ExplorerRoot['kind'] = 'issue'): ExplorerRoot {
  return { kind, id: `${kind}:x`, absPath, writable: kind !== 'project', projectKey: 'p', defaultBranch: 'main' };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PanRpcError);
    return (error as PanRpcError).code;
  }
  return 'resolved';
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('gitStatus', () => {
  it('maps every porcelain v2 record kind', async () => {
    const r = await repo({ 'a.txt': 'a\n', 'c.txt': 'c\n', 'd.txt': 'd\n', 'f.txt': 'f\n' });
    await r.git('mv', 'a.txt', 'b.txt');
    await writeFile(join(r.dir, 'c.txt'), 'c2\n');
    await r.git('add', 'c.txt');
    await writeFile(join(r.dir, 'c.txt'), 'c3\n');
    await writeFile(join(r.dir, 'd.txt'), 'd2\n');
    await writeFile(join(r.dir, 'e.txt'), 'e\n');
    await r.git('add', 'e.txt');
    await rm(join(r.dir, 'f.txt'));
    await mkdir(join(r.dir, 'newdir'));
    await writeFile(join(r.dir, 'newdir', 'x'), 'x\n');
    await writeFile(join(r.dir, 'u.txt'), 'u\n');

    const result = await gitStatus(rootAt(r.dir));
    expect(result.branch).toBe('main');
    expect(result.truncated).toBe(false);
    expect([...result.entries].sort((p, q) => p.path.localeCompare(q.path))).toEqual([
      { path: 'b.txt', status: 'renamed', staged: true },
      { path: 'c.txt', status: 'modified', staged: true },
      { path: 'd.txt', status: 'modified', staged: false },
      { path: 'e.txt', status: 'added', staged: true },
      { path: 'f.txt', status: 'deleted', staged: false },
      { path: 'newdir', status: 'untracked', staged: false },
      { path: 'u.txt', status: 'untracked', staged: false },
    ]);
  });

  it('reports a merge conflict as conflicted', async () => {
    const r = await repo({ 'm.txt': 'base\n' });
    await r.git('checkout', '-q', '-b', 'other');
    await writeFile(join(r.dir, 'm.txt'), 'other\n');
    await r.git('commit', '-q', '-am', 'other');
    await r.git('checkout', '-q', 'main');
    await writeFile(join(r.dir, 'm.txt'), 'main\n');
    await r.git('commit', '-q', '-am', 'main');
    await expect(r.git('merge', '-q', 'other')).rejects.toThrow();

    const result = await gitStatus(rootAt(r.dir));
    expect(result.entries).toEqual([{ path: 'm.txt', status: 'conflicted', staged: false }]);
  });

  it('lists files committed since the default branch for workspace roots only', async () => {
    const r = await repo({ 'a.txt': 'a\n' });
    await r.git('checkout', '-q', '-b', 'feature/x');
    await writeFile(join(r.dir, 'g.txt'), 'g\n');
    await r.git('add', 'g.txt');
    await r.git('commit', '-q', '-m', 'g');

    const issue = await gitStatus(rootAt(r.dir, 'issue'));
    expect(issue.branch).toBe('feature/x');
    expect(issue.committed).toEqual([{ path: 'g.txt', status: 'added' }]);
    expect((await gitStatus(rootAt(r.dir, 'project'))).committed).toEqual([]);
  });

  it('caps entries at maxEntries', async () => {
    const r = await repo({});
    for (const name of ['u1', 'u2', 'u3']) await writeFile(join(r.dir, name), name);
    const result = await gitStatus(rootAt(r.dir), { maxEntries: 2 });
    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('rejects a directory outside any repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'explorer-norepo-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    expect(await codeOf(gitStatus(rootAt(dir)))).toBe('NOT_A_GIT_REPO');
  });
});

describe('gitStage', () => {
  it('stages and unstages a file', async () => {
    const r = await repo({ 'a.txt': 'a\n' });
    await writeFile(join(r.dir, 'u.txt'), 'u\n');
    await gitStage(rootAt(r.dir), ['u.txt'], 'stage');
    expect((await gitStatus(rootAt(r.dir))).entries).toEqual([{ path: 'u.txt', status: 'added', staged: true }]);
    await gitStage(rootAt(r.dir), ['u.txt'], 'unstage');
    expect((await gitStatus(rootAt(r.dir))).entries).toEqual([{ path: 'u.txt', status: 'untracked', staged: false }]);
  });

  it('treats glob characters in a path literally', async () => {
    const r = await repo({});
    await writeFile(join(r.dir, '*.txt'), 'star\n');
    await writeFile(join(r.dir, 'a.txt'), 'a\n');
    await gitStage(rootAt(r.dir), ['*.txt'], 'stage');
    const entries = [...(await gitStatus(rootAt(r.dir))).entries].sort((p, q) => p.path.localeCompare(q.path));
    expect(entries).toEqual([
      { path: '*.txt', status: 'added', staged: true },
      { path: 'a.txt', status: 'untracked', staged: false },
    ]);
  });

  it('discards a change to a committed file', async () => {
    const r = await repo({ 'd.txt': 'd\n' });
    await writeFile(join(r.dir, 'd.txt'), 'changed\n');
    await gitStage(rootAt(r.dir), ['d.txt'], 'discard');
    expect(await fsReadFile(join(r.dir, 'd.txt'), 'utf8')).toBe('d\n');
  });

  it('refuses to discard a file that is not in HEAD and runs nothing', async () => {
    const r = await repo({ 'd.txt': 'd\n' });
    await writeFile(join(r.dir, 'd.txt'), 'changed\n');
    await writeFile(join(r.dir, 'u.txt'), 'u\n');
    expect(await codeOf(gitStage(rootAt(r.dir), ['d.txt', 'u.txt'], 'discard'))).toBe('NOT_IMPLEMENTED');
    expect(await exists(join(r.dir, 'u.txt'))).toBe(true);
    expect(await fsReadFile(join(r.dir, 'd.txt'), 'utf8')).toBe('changed\n');
  });

  it('refuses to discard a directory holding a staged file that is not in HEAD', async () => {
    const r = await repo({ 'dir/a.txt': 'a\n' });
    await writeFile(join(r.dir, 'dir', 'new.txt'), 'new\n');
    await r.git('add', 'dir/new.txt');
    await writeFile(join(r.dir, 'dir', 'a.txt'), 'changed\n');
    expect(await codeOf(gitStage(rootAt(r.dir), ['dir'], 'discard'))).toBe('NOT_IMPLEMENTED');
    expect(await exists(join(r.dir, 'dir', 'new.txt'))).toBe(true);
    expect(await fsReadFile(join(r.dir, 'dir', 'a.txt'), 'utf8')).toBe('changed\n');
  });

  it('refuses changes on a project root', async () => {
    const r = await repo({ 'a.txt': 'a\n' });
    expect(await codeOf(gitStage(rootAt(r.dir, 'project'), ['a.txt'], 'stage'))).toBe('EDIT_WORKSPACE_REQUIRED');
  });

  it('refuses a root that is a subdirectory of an enclosing repository', async () => {
    const r = await repo({ 'sub/keep.txt': 'k\n', 'f.txt': 'f\n' });
    await writeFile(join(r.dir, 'sub', 'f.txt'), 'f\n');
    expect(await codeOf(gitStage(rootAt(join(r.dir, 'sub')), ['f.txt'], 'stage'))).toBe('NOT_A_GIT_REPO');
    expect(await r.git('diff', '--cached', '--name-only')).toBe('');
  });
});
