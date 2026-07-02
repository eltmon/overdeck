import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolvePrimaryWorktreeRoot } from '../../../../src/cli/commands/flywheel.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-flywheel-root-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepoWithCommit(repoPath: string): void {
  git(tempRoot, 'init', '-b', 'main', repoPath);
  git(repoPath, 'config', 'user.email', 'test@test');
  git(repoPath, 'config', 'user.name', 'test');
  git(repoPath, 'commit', '--allow-empty', '-m', 'init');
}

describe('resolvePrimaryWorktreeRoot (flywheel must not spawn in a feature worktree)', () => {
  it('maps a linked worktree cwd back to the primary root', async () => {
    const primary = join(tempRoot, 'repo');
    initRepoWithCommit(primary);
    const worktree = join(primary, 'workspaces', 'feature-pan-1');
    git(primary, 'worktree', 'add', worktree, '-b', 'feature/pan-1');

    await expect(resolvePrimaryWorktreeRoot(worktree)).resolves.toBe(primary);
  });

  it('keeps the primary root when already there', async () => {
    const primary = join(tempRoot, 'repo');
    initRepoWithCommit(primary);

    await expect(resolvePrimaryWorktreeRoot(primary)).resolves.toBe(primary);
  });

  it('maps a subdirectory of a linked worktree back to the primary root', async () => {
    const primary = join(tempRoot, 'repo');
    initRepoWithCommit(primary);
    const worktree = join(primary, 'workspaces', 'feature-pan-2');
    git(primary, 'worktree', 'add', worktree, '-b', 'feature/pan-2');
    const sub = join(worktree, 'docs');
    execFileSync('mkdir', ['-p', sub]);

    await expect(resolvePrimaryWorktreeRoot(sub)).resolves.toBe(primary);
  });

  it('falls back to the given cwd outside a git repo', async () => {
    const plain = join(tempRoot, 'not-a-repo');
    execFileSync('mkdir', ['-p', plain]);

    await expect(resolvePrimaryWorktreeRoot(plain)).resolves.toBe(plain);
  });
});
