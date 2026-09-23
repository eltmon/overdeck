/**
 * Worker worktree residue against a real git repository (review of #4027).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

let root: string;
let project: string;
let workspace: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'worker-worktrees-'));
  project = join(root, 'project');
  git(root, 'init', '--quiet', '-b', 'main', project);
  writeFileSync(join(project, 'README.md'), 'x\n');
  git(project, 'add', 'README.md');
  git(project, 'commit', '--quiet', '-m', 'init');
  workspace = join(project, 'workspaces', 'feature-pan-7');
  git(project, 'worktree', 'add', '--quiet', '-b', 'feature/pan-7', workspace, 'main');
  // worker-1: no commits of its own. worker-2: one commit. item-a: a pan spawn item.
  await createItemWorktree(workspace, 'worker-1');
  const worker2 = await createItemWorktree(workspace, 'worker-2');
  writeFileSync(join(worker2, 'work.txt'), 'w\n');
  git(worker2, 'add', 'work.txt');
  git(worker2, 'commit', '--quiet', '-m', 'worker work');
  await createItemWorktree(workspace, 'item-a');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('reapWorkerWorktrees', () => {
  it('removes worker worktrees and only branches with no work of their own in merged mode', async () => {
    const actions = await reapWorkerWorktrees(project, 'PAN-7', { deleteBranches: 'merged' });

    expect(existsSync(join(workspace, '.swarm', 'worker-1'))).toBe(false);
    expect(existsSync(join(workspace, '.swarm', 'worker-2'))).toBe(false);
    expect(existsSync(join(workspace, '.swarm', 'item-a'))).toBe(true);
    expect(git(project, 'worktree', 'list')).not.toContain('.swarm/worker-');
    expect(branches(project)).toEqual(['feature/pan-7', 'feature/pan-7-item-a', 'feature/pan-7-worker-2', 'main']);
    expect(actions).toContain('kept worker branch feature/pan-7-worker-2: it has commits of its own');
  });

  it('deletes every worker branch in all mode', async () => {
    await reapWorkerWorktrees(project, 'PAN-7', { deleteBranches: 'all' });
    expect(branches(project)).toEqual(['feature/pan-7', 'feature/pan-7-item-a', 'main']);
  });

  it('is a no-op outside a repository', async () => {
    expect(await reapWorkerWorktrees(root, 'PAN-7', { deleteBranches: 'all' })).toEqual([]);
  });
});
