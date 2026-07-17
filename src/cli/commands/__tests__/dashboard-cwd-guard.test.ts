import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { refuseNonPrimaryDashboardCwd } from '../restart.js';

const fixtureRoots: string[] = [];

function createFixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.push(root);
  return root;
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('refuseNonPrimaryDashboardCwd', () => {
  it('refuses a linked worktree and names its primary checkout', () => {
    const fixtureRoot = createFixture('pan-dashboard-cwd-linked-');
    const repoRoot = join(fixtureRoot, 'hoff-gh-quota');
    const cwd = join(repoRoot, 'src', 'cli');
    const primaryRoot = join(fixtureRoot, 'primary');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(repoRoot, '.git'), `gitdir: ${join(primaryRoot, '.git', 'worktrees', 'hoff-gh-quota')}\n`);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(refuseNonPrimaryDashboardCwd(cwd, 'restart')).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(
      `Run this command from the primary checkout at ${primaryRoot}.`,
    ));
  });

  it('allows primary clones and directories outside git repositories', () => {
    const fixtureRoot = createFixture('pan-dashboard-cwd-primary-');
    const primaryRoot = join(fixtureRoot, 'primary');
    const primaryCwd = join(primaryRoot, 'src');
    const noGitCwd = join(fixtureRoot, 'no-git', 'src');
    mkdirSync(join(primaryRoot, '.git'), { recursive: true });
    mkdirSync(primaryCwd, { recursive: true });
    mkdirSync(noGitCwd, { recursive: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(refuseNonPrimaryDashboardCwd(primaryCwd, 'restart')).toBe(false);
    expect(refuseNonPrimaryDashboardCwd(noGitCwd, 'restart')).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it('preserves workspace refusal and derives the primary checkout', () => {
    const fixtureRoot = createFixture('pan-dashboard-cwd-workspace-');
    const repoRoot = join(fixtureRoot, 'workspaces', 'feature-pan-2252');
    const cwd = join(repoRoot, 'src', 'cli');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(refuseNonPrimaryDashboardCwd(cwd, 'restart')).toBe(true);
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(
      `Run this command from the primary checkout at ${fixtureRoot}.`,
    ));
  });
});
