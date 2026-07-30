import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installPreRebaseHook } from '../worktree-ops.js';

/**
 * PAN-3266: `core.hooksPath` is `.husky/_`, a path inside the working tree.
 * `installPreRebaseHook` creates that directory itself when a worktree is
 * created — before `prepare: husky` has run and written husky's own `*`
 * .gitignore into it. Without the self-ignore the generated guard shows up as
 * `?? .husky/_/pre-rebase`, so every new workspace was born dirty and the
 * planning auto-handoff refused to start work in it.
 */
describe('installPreRebaseHook self-ignores a generated in-tree hooks directory', () => {
  let root: string;

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pre-rebase-hook-'));
    git(['init', '--quiet']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(root, 'README.md'), 'base\n');
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'base']);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves git status clean when the hooks dir lives inside the worktree', async () => {
    git(['config', 'core.hooksPath', '.husky/_']);

    const hookPath = await installPreRebaseHook(root);

    expect(hookPath).toBe(join(root, '.husky/_/pre-rebase'));
    expect(readFileSync(join(root, '.husky/_/.gitignore'), 'utf-8')).toBe('*\n');
    expect(git(['status', '--porcelain', '--untracked-files=all'])).toBe('');
  });

  it('does not clobber the self-ignore husky already wrote', async () => {
    git(['config', 'core.hooksPath', '.husky/_']);
    mkdirSync(join(root, '.husky/_'), { recursive: true });
    writeFileSync(join(root, '.husky/_/.gitignore'), '*', 'utf-8');

    await installPreRebaseHook(root);

    expect(readFileSync(join(root, '.husky/_/.gitignore'), 'utf-8')).toBe('*');
    expect(git(['status', '--porcelain', '--untracked-files=all'])).toBe('');
  });

  it('writes no .gitignore when hooks live under .git, which git never reports', async () => {
    const hookPath = await installPreRebaseHook(root);

    expect(hookPath).toBe(join(root, '.git/hooks/pre-rebase'));
    expect(existsSync(join(root, '.git/hooks/.gitignore'))).toBe(false);
    expect(git(['status', '--porcelain', '--untracked-files=all'])).toBe('');
  });
});
