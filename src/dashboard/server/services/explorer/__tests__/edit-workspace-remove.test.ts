import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import { removeEditWorkspace } from '../edit-workspace-remove.js';
import { runGit, type GitRunResult } from '../git-exec.js';
import { makeFixtureRepo, type FixtureRepo } from './fixture-repo.js';

const execFileAsync = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function row(path: string, branch = 'scratch/edit-1'): WorkspaceRow {
  return {
    id: 'w1',
    projectId: 'p',
    kind: 'scratch',
    name: branch.replace(/^scratch\//, ''),
    path,
    branchName: branch,
    parentBranch: 'main',
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: null,
    layoutConfig: null,
    runCommand: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    createdAt: 1,
    lastAccessedAt: 1,
  };
}

/** A primary repo with a bare origin and a real worktree on scratch/edit-1. */
async function setup(): Promise<{ repo: FixtureRepo; bare: string; worktree: string }> {
  const repo = await makeFixtureRepo({ 'README.md': 'hello\n' });
  cleanups.push(repo.cleanup);
  const bare = await mkdtemp(join(tmpdir(), 'explorer-bare-'));
  cleanups.push(() => rm(bare, { recursive: true, force: true }));
  await execFileAsync('git', ['init', '-q', '--bare', bare]);
  await repo.git('remote', 'add', 'origin', bare);
  await repo.git('push', '-q', 'origin', 'main');
  const worktree = join(repo.dir, 'workspaces', 'scratch-edit-1');
  await repo.git('worktree', 'add', '-q', '-b', 'scratch/edit-1', worktree, 'main');
  return { repo, bare, worktree };
}

async function remoteHas(bare: string, ref: string): Promise<boolean> {
  return execFileAsync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: bare }).then(
    () => true,
    () => false,
  );
}

describe('removeEditWorkspace', () => {
  it('removes the worktree and the local branch, then deletes the row', async () => {
    const { repo, worktree } = await setup();
    const deleteWorkspace = vi.fn(async () => {});
    await removeEditWorkspace({ row: row(worktree), primaryPath: repo.dir }, { force: false, deleteRemoteBranch: false }, { deleteWorkspace });
    expect(await exists(worktree)).toBe(false);
    expect((await repo.git('branch', '--list', 'scratch/edit-1')).trim()).toBe('');
    expect(deleteWorkspace).toHaveBeenCalledWith('w1');
  });

  it('refuses a dirty worktree without force and removes it with force', async () => {
    const { repo, worktree } = await setup();
    await writeFile(join(worktree, 'dirty.txt'), 'x\n');
    const deleteWorkspace = vi.fn(async () => {});
    const target = { row: row(worktree), primaryPath: repo.dir };
    await expect(removeEditWorkspace(target, { force: false, deleteRemoteBranch: false }, { deleteWorkspace })).rejects.toMatchObject({
      code: 'REMOVE_FAILED',
      status: 409,
    });
    expect(await exists(worktree)).toBe(true);
    expect(deleteWorkspace).not.toHaveBeenCalled();
    await removeEditWorkspace(target, { force: true, deleteRemoteBranch: false }, { deleteWorkspace });
    expect(await exists(worktree)).toBe(false);
  });

  it('deletes the pushed remote branch when asked', async () => {
    const { repo, bare, worktree } = await setup();
    await execFileAsync('git', ['push', '-q', '--set-upstream', 'origin', 'HEAD:refs/heads/scratch/edit-1'], { cwd: worktree });
    expect(await remoteHas(bare, 'refs/heads/scratch/edit-1')).toBe(true);
    await removeEditWorkspace(
      { row: row(worktree), primaryPath: repo.dir },
      { force: false, deleteRemoteBranch: true },
      { deleteWorkspace: async () => {} },
    );
    expect(await remoteHas(bare, 'refs/heads/scratch/edit-1')).toBe(false);
  });

  it('runs no git push for a branch that was never pushed', async () => {
    const { repo, worktree } = await setup();
    const calls: string[][] = [];
    const recording: typeof runGit = async (cwd, args, opts) => {
      calls.push([...args]);
      return runGit(cwd, args, opts);
    };
    await removeEditWorkspace(
      { row: row(worktree), primaryPath: repo.dir },
      { force: false, deleteRemoteBranch: true },
      { runGit: recording, deleteWorkspace: async () => {} },
    );
    expect(calls.some((args) => args[0] === 'push')).toBe(false);
    expect(await exists(worktree)).toBe(false);
  });

  it('rejects a row on scratch/notes before running any git command', async () => {
    const calls: string[][] = [];
    const fake: typeof runGit = async (_cwd, args): Promise<GitRunResult> => {
      calls.push([...args]);
      return { code: 0, stdout: Buffer.alloc(0), stderr: '', timedOut: false, truncated: false };
    };
    const deleteWorkspace = vi.fn(async () => {});
    await expect(
      removeEditWorkspace(
        { row: row('/p/workspaces/scratch-notes', 'scratch/notes'), primaryPath: '/p' },
        { force: true, deleteRemoteBranch: true },
        { runGit: fake, deleteWorkspace },
      ),
    ).rejects.toMatchObject({ code: 'NOT_AN_EDIT_WORKSPACE' });
    expect(calls).toHaveLength(0);
    expect(deleteWorkspace).not.toHaveBeenCalled();
  });
});
