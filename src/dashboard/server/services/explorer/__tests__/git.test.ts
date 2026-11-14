import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile as fsReadFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import { gitStage, gitStatus } from '../git.js';
import type { ExplorerRoot } from '../roots.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const execFileAsync = promisify(execFile);

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
    expect(await gitStage(rootAt(r.dir), ['d.txt'], 'discard')).toEqual({ trashIds: [] });
    expect(await fsReadFile(join(r.dir, 'd.txt'), 'utf8')).toBe('d\n');
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

describe('gitStage discard to the trash', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    previousHome = process.env.OVERDECK_HOME;
    home = await mkdtemp(join(tmpdir(), 'explorer-git-trash-home-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(async () => {
    process.env.OVERDECK_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  function trashFile(trashId: string, rel: string): string {
    return join(home, 'trash', trashId, 'files', rel);
  }

  it('trashes an untracked file and restores a committed one in one call', async () => {
    const r = await repo({ 'd.txt': 'd\n' });
    await writeFile(join(r.dir, 'd.txt'), 'changed\n');
    await writeFile(join(r.dir, 'u.txt'), 'u\n');

    const result = await gitStage(rootAt(r.dir), ['d.txt', 'u.txt'], 'discard');
    expect(result.trashIds).toHaveLength(1);
    expect(await fsReadFile(join(r.dir, 'd.txt'), 'utf8')).toBe('d\n');
    expect(await exists(join(r.dir, 'u.txt'))).toBe(false);
    expect(await exists(trashFile(result.trashIds[0]!, 'u.txt'))).toBe(true);
  });

  it('unstages and trashes a staged-new file edited after staging', async () => {
    const r = await repo({});
    await writeFile(join(r.dir, 'n.txt'), 'n\n');
    await r.git('add', 'n.txt');
    await writeFile(join(r.dir, 'n.txt'), 'n2\n');

    const result = await gitStage(rootAt(r.dir), ['n.txt'], 'discard');
    expect(result.trashIds).toHaveLength(1);
    expect(await exists(join(r.dir, 'n.txt'))).toBe(false);
    expect(await r.git('ls-files', 'n.txt')).toBe('');
  });

  it('restores committed files and trashes only new entries in a mixed folder', async () => {
    const r = await repo({ 'dir/a.txt': 'a\n' });
    await writeFile(join(r.dir, 'dir', 'a.txt'), 'changed\n');
    await writeFile(join(r.dir, 'dir', 'new.txt'), 'new\n');
    await r.git('add', 'dir/new.txt');
    await mkdir(join(r.dir, 'dir', 'sub'));
    await writeFile(join(r.dir, 'dir', 'sub', 's.txt'), 's\n');

    const result = await gitStage(rootAt(r.dir), ['dir'], 'discard');
    expect(result.trashIds).toHaveLength(2);
    expect(await fsReadFile(join(r.dir, 'dir', 'a.txt'), 'utf8')).toBe('a\n');
    expect(await exists(join(r.dir, 'dir', 'new.txt'))).toBe(false);
    expect(await exists(join(r.dir, 'dir', 'sub'))).toBe(false);
  });

  it('trashes a new folder with one staged and one untracked file as one entry', async () => {
    const r = await repo({});
    await mkdir(join(r.dir, 'nd'));
    await writeFile(join(r.dir, 'nd', 's.txt'), 's\n');
    await r.git('add', 'nd/s.txt');
    await writeFile(join(r.dir, 'nd', 'u.txt'), 'u\n');

    const result = await gitStage(rootAt(r.dir), ['nd'], 'discard');
    expect(result.trashIds).toHaveLength(1);
    expect(await exists(join(r.dir, 'nd'))).toBe(false);
  });

  it('never trashes an ignored file', async () => {
    const r = await repo({ '.gitignore': '*.log\n', 'a.txt': 'a\n' });
    await writeFile(join(r.dir, 'x.log'), 'x\n');
    await writeFile(join(r.dir, 'a.txt'), 'changed\n');

    const result = await gitStage(rootAt(r.dir), ['a.txt', 'x.log'], 'discard');
    expect(result.trashIds).toEqual([]);
    expect(await exists(join(r.dir, 'x.log'))).toBe(true);
  });

  it('trashes a new folder whole, ignored files inside included', async () => {
    const r = await repo({ '.gitignore': '*.log\n' });
    await mkdir(join(r.dir, 'newdir'));
    await writeFile(join(r.dir, 'newdir', 'x'), 'x\n');
    await writeFile(join(r.dir, 'newdir', 'z.log'), 'z\n');

    const result = await gitStage(rootAt(r.dir), ['newdir'], 'discard');
    expect(result.trashIds).toHaveLength(1);
    expect(await exists(trashFile(result.trashIds[0]!, 'newdir/z.log'))).toBe(true);
  });

  it('unstages a staged-new file that is missing on disk', async () => {
    const r = await repo({});
    await writeFile(join(r.dir, 'g.txt'), 'g\n');
    await r.git('add', 'g.txt');
    await rm(join(r.dir, 'g.txt'));

    expect(await gitStage(rootAt(r.dir), ['g.txt'], 'discard')).toEqual({ trashIds: [] });
    expect(await r.git('ls-files', 'g.txt')).toBe('');
  });

  it('changes nothing when the HEAD read fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'explorer-git-nohead-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    await writeFile(join(dir, 'u.txt'), 'u\n');

    expect(await codeOf(gitStage(rootAt(dir), ['u.txt'], 'discard'))).toBe('EXPLORER_FAILED');
    expect(await exists(join(dir, 'u.txt'))).toBe(true);
  });

  it('reports the trash ids when the HEAD restore fails after a trash', async () => {
    const r = await repo({ 'd.txt': 'd\n' });
    await writeFile(join(r.dir, 'd.txt'), 'changed\n');
    await writeFile(join(r.dir, 'u.txt'), 'u\n');
    await writeFile(join(r.dir, '.git', 'index.lock'), '');

    let error: unknown;
    try {
      await gitStage(rootAt(r.dir), ['d.txt', 'u.txt'], 'discard');
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PanRpcError);
    expect((error as PanRpcError).code).toBe('EXPLORER_FAILED');
    expect((error as PanRpcError).message).toContain('moved to the Overdeck trash: issue-x/');
    expect(await fsReadFile(join(r.dir, 'd.txt'), 'utf8')).toBe('changed\n');
    expect(await exists(join(home, 'trash'))).toBe(true);
  });
});
