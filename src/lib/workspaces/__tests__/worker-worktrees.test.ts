/**
 * Worker worktree residue against a real git repository (reviews of #4027).
 *
 * A worker branch exists only on this machine, so it is deleted only when its
 * tip is already in the default branch or the (still existing) feature branch;
 * worktrees go only when the caller deletes the workspace.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeWorkerWorktrees } from '../../lifecycle/teardown-workspace.js';
import { createItemWorktree } from '../item-worktree.js';
import { reapWorkerWorktrees } from '../worker-worktrees.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function branches(project: string): string[] {
  return git(project, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').filter(Boolean).sort();
}

function commitIn(dir: string, file: string): void {
  writeFileSync(join(dir, file), `${file}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', file);
}

let root: string;
let project: string;
let workspace: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'reap-residue-'));
  project = join(root, 'project');
  git(root, 'init', '--quiet', '-b', 'main', project);
  commitIn(project, 'README.md');
  workspace = join(project, 'workspaces', 'feature-pan-7');
  git(project, 'worktree', 'add', '--quiet', '-b', 'feature/pan-7', workspace, 'main');
  // worker-1: no commits of its own. worker-2: a commit later merged to main.
  // worker-3: a commit nowhere else. item-a: a pan spawn item, never touched.
  await createItemWorktree(workspace, 'worker-1');
  commitIn(await createItemWorktree(workspace, 'worker-2'), 'merged.txt');
  commitIn(await createItemWorktree(workspace, 'worker-3'), 'unmerged.txt');
  await createItemWorktree(workspace, 'item-a');
  git(project, 'merge', '--quiet', '--ff-only', 'feature/pan-7-worker-2');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('reapWorkerWorktrees', () => {
  it('deletes merged worker branches and keeps an unmerged one, naming its commit count', async () => {
    const actions = await reapWorkerWorktrees(project, 'PAN-7', { removeWorktrees: true });

    for (const n of [1, 2, 3]) expect(existsSync(join(workspace, '.swarm', `worker-${n}`))).toBe(false);
    expect(existsSync(join(workspace, '.swarm', 'item-a'))).toBe(true);
    expect(git(project, 'worktree', 'list')).not.toContain('.swarm/worker-');
    expect(branches(project)).toEqual(['feature/pan-7', 'feature/pan-7-item-a', 'feature/pan-7-worker-3', 'main']);
    expect(actions).toContain('deleted worker branch feature/pan-7-worker-1');
    expect(actions).toContain('deleted worker branch feature/pan-7-worker-2');
    expect(actions).toContain('kept worker branch feature/pan-7-worker-3: 1 unmerged commit(s)');
  });

  it('keeps an unmerged worker branch after the feature branch is gone', async () => {
    for (const n of [1, 2, 3]) git(project, 'worktree', 'remove', '--force', join(workspace, '.swarm', `worker-${n}`));
    git(project, 'worktree', 'remove', '--force', join(workspace, '.swarm', 'item-a'));
    git(project, 'worktree', 'remove', '--force', workspace);
    git(project, 'branch', '-D', 'feature/pan-7');

    const actions = await reapWorkerWorktrees(project, 'PAN-7', { removeWorktrees: true });

    expect(branches(project)).toEqual(['feature/pan-7-item-a', 'feature/pan-7-worker-3', 'main']);
    expect(actions).toContain('kept worker branch feature/pan-7-worker-3: 1 unmerged commit(s)');
  });

  it('keeps worker worktrees and their checked-out branches when the workspace is kept', async () => {
    writeFileSync(join(workspace, '.swarm', 'worker-1', 'draft.txt'), 'uncommitted\n');
    const actions = await reapWorkerWorktrees(project, 'PAN-7', { removeWorktrees: false });

    expect(existsSync(join(workspace, '.swarm', 'worker-1', 'draft.txt'))).toBe(true);
    expect(branches(project)).toContain('feature/pan-7-worker-1');
    expect(actions.some((action) => action.startsWith('kept worker branch feature/pan-7-worker-1: checked out in'))).toBe(true);
  });

  it('is a no-op outside a repository', async () => {
    expect(await reapWorkerWorktrees(root, 'PAN-7', { removeWorktrees: true })).toEqual([]);
  });
});

describe('teardown step teardown:worker-worktrees', () => {
  it('keeps worker worktrees when the teardown keeps the workspace', async () => {
    writeFileSync(join(workspace, '.swarm', 'worker-3', 'draft.txt'), 'uncommitted\n');
    const step = await Effect.runPromise(removeWorkerWorktrees(project, 'PAN-7', false));

    expect(step.step).toBe('teardown:worker-worktrees');
    expect(existsSync(join(workspace, '.swarm', 'worker-3', 'draft.txt'))).toBe(true);
    expect(git(project, 'worktree', 'list')).toContain('.swarm/worker-3');
  });

  it('removes them when the teardown deletes the workspace', async () => {
    await Effect.runPromise(removeWorkerWorktrees(project, 'PAN-7', true));
    expect(git(project, 'worktree', 'list')).not.toContain('.swarm/worker-');
    expect(branches(project)).toContain('feature/pan-7-worker-3');
  });
});
