/**
 * Executes the generated git-guard shim end-to-end: read-only `stash list` /
 * `stash show` must reach real git, while state-moving stash verbs, bare
 * `git stash`, and `git rebase` stay blocked. Regression cover for the
 * 2026-07-26 workspaces-route GitError storm, where a dashboard behind the
 * shim had its read-only stash enumeration rejected.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildGitGuardLines } from '../launcher-git-guard.js';

let home: string;
let repo: string;
let guardGit: string;
let previousHome: string | undefined;

interface GuardRunResult {
  status: number;
  stderr: string;
}

function runGuardedGit(args: string[], cwd: string): GuardRunResult {
  try {
    execFileSync(guardGit, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OVERDECK_PAN_GIT_OP: '' },
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const err = error as { status?: number | null; stderr?: Buffer | string };
    return { status: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'git-guard-behavior-'));
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;

  execFileSync('bash', ['-ec', buildGitGuardLines('guard-behavior-test').join('\n')], {
    cwd: home,
    stdio: 'ignore',
  });
  guardGit = join(home, 'agents', 'guard-behavior-test', 'git-guard', 'git');

  repo = join(home, 'scratch-repo');
  execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore' });
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('git-guard shim behavior', () => {
  it('allows read-only git stash list', () => {
    const result = runGuardedGit(['stash', 'list'], repo);
    expect(result.stderr).not.toContain('must not run git stash');
    expect(result.status).toBe(0);
  });

  it('allows git -C <dir> stash list', () => {
    const result = runGuardedGit(['-C', repo, 'stash', 'list'], home);
    expect(result.stderr).not.toContain('must not run git stash');
    expect(result.status).toBe(0);
  });

  it('blocks bare git stash', () => {
    const result = runGuardedGit(['stash'], repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not run git stash');
  });

  it('blocks git stash pop', () => {
    const result = runGuardedGit(['stash', 'pop'], repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not run git stash');
  });

  it('blocks git rebase', () => {
    const result = runGuardedGit(['rebase', 'main'], repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not run git rebase');
  });

  it('blocks git reset --hard', () => {
    const result = runGuardedGit(['reset', '--hard'], repo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not run git reset --hard');
  });
});
