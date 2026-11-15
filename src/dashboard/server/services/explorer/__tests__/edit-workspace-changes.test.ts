/** PAN-5290 WI-5: what an edit workspace will land, on a real repository with a bare origin. */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectConfig } from '../../../../../lib/projects.js';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import { getEditWorkspaceChanges } from '../edit-workspace-changes.js';
import type { EditWorkspaceDeps } from '../edit-workspace.js';
import type { ExplorerRoot } from '../roots.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const execFileAsync = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

// A 1x1 PNG: binary, with NUL bytes in its header.
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

/** An edit worktree checkout whose origin is a bare repository holding main. */
async function editRepo(files: Record<string, string>, opts: { remote?: boolean } = {}): Promise<FixtureRepo> {
  const repo = await makeFixtureRepo(files);
  cleanups.push(repo.cleanup);
  if (opts.remote !== false) {
    const bare = await mkdtemp(join(tmpdir(), 'explorer-bare-'));
    cleanups.push(() => rm(bare, { recursive: true, force: true }));
    await execFileAsync('git', ['init', '-q', '--bare', bare]);
    await repo.git('remote', 'add', 'origin', bare);
    await repo.git('push', '-q', 'origin', 'main');
    await repo.git('fetch', '-q', 'origin');
  }
  await repo.git('checkout', '-q', '-b', 'scratch/edit-1115-1200');
  return repo;
}

function deps(dir: string): EditWorkspaceDeps {
  const row = {
    id: 'w1', projectId: 'p', kind: 'scratch', origin: 'operator', name: 'edit-1115-1200', path: dir, branchName: 'scratch/edit-1115-1200',
    parentBranch: 'main', parentBranchGuessed: false, isGitRepository: true, issueId: null, layoutConfig: null,
    runCommand: null, isFavorite: false, isArchived: false, title: null, createdAt: 1, lastAccessedAt: 1,
  } as WorkspaceRow;
  const root: ExplorerRoot = { kind: 'workspace', id: 'workspace:w1', absPath: dir, writable: true, projectKey: 'p', workspaceId: 'w1', defaultBranch: 'main' };
  return {
    resolveRoot: async () => root,
    getWorkspaceById: () => row,
    listProjects: async () => [{ key: 'p', config: { name: 'p', path: dir } as ProjectConfig }],
  };
}

describe('getEditWorkspaceChanges', () => {
  it('lists modified, added, deleted, untracked and binary files with +/− and omits ignored files', async () => {
    const repo = await editRepo({
      'README.md': 'one\ntwo\nthree\n',
      'gone.txt': 'a\nb\n',
      'logo.bin': '\u0000\u0001\u0002',
      '.gitignore': 'ignored.log\n',
    });
    await writeFile(join(repo.dir, 'README.md'), 'one\nTWO\nthree\nfour\n');
    await rm(join(repo.dir, 'gone.txt'));
    await writeFile(join(repo.dir, 'added.ts'), 'export const a = 1\n');
    await repo.git('add', 'added.ts');
    await mkdir(join(repo.dir, 'notes'), { recursive: true });
    await writeFile(join(repo.dir, 'notes/new.md'), 'x\ny\n\nz');
    await writeFile(join(repo.dir, 'image.png'), PNG);
    await writeFile(join(repo.dir, 'logo.bin'), '\u0000\u0003');
    await writeFile(join(repo.dir, 'ignored.log'), 'noise\n');

    const changes = await getEditWorkspaceChanges('w1', deps(repo.dir));

    expect(changes.base).toBe((await repo.git('rev-parse', 'refs/remotes/origin/main')).trim());
    expect(changes.files).toEqual([
      { path: 'README.md', status: 'M', additions: 2, deletions: 1, binary: false },
      { path: 'added.ts', status: 'A', additions: 1, deletions: 0, binary: false },
      { path: 'gone.txt', status: 'D', additions: 0, deletions: 2, binary: false },
      { path: 'image.png', status: 'A', additions: 0, deletions: 0, binary: true },
      { path: 'logo.bin', status: 'M', additions: 0, deletions: 0, binary: true },
      { path: 'notes/new.md', status: 'A', additions: 4, deletions: 0, binary: false },
    ]);
    expect(changes.additions).toBe(7);
    expect(changes.deletions).toBe(3);
    expect(changes.uncommittedPaths.sort()).toEqual(['README.md', 'added.ts', 'gone.txt', 'image.png', 'logo.bin', 'notes/new.md']);
  });

  it('counts a commit on the edit branch against the merge base and leaves it out of uncommittedPaths', async () => {
    const repo = await editRepo({ 'README.md': 'hello\n' });
    await writeFile(join(repo.dir, 'committed.md'), 'c1\nc2\n');
    await repo.git('add', 'committed.md');
    await repo.git('commit', '-q', '-m', 'edit');
    await writeFile(join(repo.dir, 'README.md'), 'hello\nworld\n');

    const changes = await getEditWorkspaceChanges('w1', deps(repo.dir));

    expect(changes.files).toEqual([
      { path: 'README.md', status: 'M', additions: 1, deletions: 0, binary: false },
      { path: 'committed.md', status: 'A', additions: 2, deletions: 0, binary: false },
    ]);
    expect(changes.uncommittedPaths).toEqual(['README.md']);
  });

  it('falls back to HEAD when there is no merge base', async () => {
    const repo = await editRepo({ 'README.md': 'hello\n' }, { remote: false });
    await writeFile(join(repo.dir, 'README.md'), 'bye\n');

    const changes = await getEditWorkspaceChanges('w1', deps(repo.dir));

    expect(changes.base).toBe('HEAD');
    expect(changes.files).toEqual([{ path: 'README.md', status: 'M', additions: 1, deletions: 1, binary: false }]);
  });

  it('lists both paths of a staged rename as uncommitted (CodeRabbit 4578715373)', async () => {
    const repo = await editRepo({ 'old.ts': 'export const a = 1\n' });
    await repo.git('mv', 'old.ts', 'new.ts');

    const changes = await getEditWorkspaceChanges('w1', deps(repo.dir));

    expect(changes.uncommittedPaths.sort()).toEqual(['new.ts', 'old.ts']);
    expect(changes.files.map((f) => [f.path, f.status])).toEqual([['new.ts', 'A'], ['old.ts', 'D']]);
  });

  it('refuses a merge-base run that was killed instead of falling back to HEAD (CodeRabbit 4578715378)', async () => {
    const repo = await editRepo({ 'README.md': 'hello\n' });
    const real = deps(repo.dir);
    const { runGit } = await import('../git-exec.js');
    const killed: NonNullable<EditWorkspaceDeps['runGit']> = async (cwd, args, opts) =>
      args[0] === 'merge-base'
        ? { code: null, stdout: Buffer.from(''), stderr: '', timedOut: true, truncated: false }
        : runGit(cwd, args, opts);

    await expect(getEditWorkspaceChanges('w1', { ...real, runGit: killed })).rejects.toThrow('git merge-base did not finish');
  });
});
