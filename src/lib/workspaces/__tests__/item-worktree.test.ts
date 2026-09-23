/**
 * createItemWorktree against a real git repository (review of #4027): the
 * workspace sits on `feature/pan-N`, and the item branch must be a sibling
 * (`feature/pan-N-worker-1`), because git refuses to create
 * `feature/pan-N/worker-1` while `feature/pan-N` exists.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createItemWorktree, worktreeBranch } from '../item-worktree.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let root: string;
let workspace: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'item-worktree-'));
  const project = join(root, 'project');
  git(root, 'init', '--quiet', '-b', 'main', project);
  writeFileSync(join(project, 'README.md'), 'x\n');
  git(project, 'add', 'README.md');
  git(project, 'commit', '--quiet', '-m', 'init');
  workspace = join(project, 'workspaces', 'feature-pan-7');
  git(project, 'worktree', 'add', '--quiet', '-b', 'feature/pan-7', workspace, 'main');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createItemWorktree (real git)', () => {
  it('cuts .swarm/<item> on the sibling branch <feature>-<item>', async () => {
    const path = await createItemWorktree(workspace, 'worker-1');

    expect(path).toBe(join(workspace, '.swarm', 'worker-1'));
    expect(existsSync(join(path, 'README.md'))).toBe(true);
    expect(await worktreeBranch(path)).toBe('feature/pan-7-worker-1');
    expect(git(workspace, 'rev-parse', 'feature/pan-7-worker-1')).toBe(git(workspace, 'rev-parse', 'feature/pan-7'));
  });

  it('reuses an existing worktree and re-attaches an existing item branch', async () => {
    const first = await createItemWorktree(workspace, 'worker-2');
    expect(await createItemWorktree(workspace, 'worker-2')).toBe(first);

    git(workspace, 'worktree', 'remove', '--force', first);
    const again = await createItemWorktree(workspace, 'worker-2');
    expect(await worktreeBranch(again)).toBe('feature/pan-7-worker-2');
  });
});
