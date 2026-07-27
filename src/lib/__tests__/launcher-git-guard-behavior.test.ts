/**
 * Executes the generated git-guard shim end-to-end: read-only `stash list` /
 * `stash show` must reach real git, while state-moving stash verbs, bare
 * `git stash`, and `git rebase` stay blocked. Regression cover for the
 * 2026-07-26 workspaces-route GitError storm, where a dashboard behind the
 * shim had its read-only stash enumeration rejected.
 *
 * PAN-3189 adds the two scoping rules: the guard fires only inside the agent's
 * own worktree, and the launcher strips any inherited guard dir from PATH
 * before resolving real git or installing its own.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildGitGuardLines } from '../launcher-git-guard.js';

let home: string;
let repo: string;
let fixtureRepo: string;
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

  // The agent's worktree — the only place the guard is allowed to fire.
  repo = join(home, 'scratch-repo');
  execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore' });

  // An unrelated repository standing in for a test fixture's temp repo.
  fixtureRepo = join(home, 'fixture-repo');
  execFileSync('git', ['init', '--quiet', fixtureRepo], { stdio: 'ignore' });

  execFileSync('bash', ['-ec', buildGitGuardLines('guard-behavior-test', repo).join('\n')], {
    cwd: home,
    stdio: 'ignore',
  });
  guardGit = join(home, 'agents', 'guard-behavior-test', 'git-guard', 'git');
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

describe('git-guard worktree scoping (PAN-3189)', () => {
  it('lets a test fixture rebase, stash and reset --hard its own temp repo', () => {
    for (const args of [['rebase', 'main'], ['stash', 'push'], ['reset', '--hard']]) {
      const result = runGuardedGit(args, fixtureRepo);
      expect(result.stderr).not.toContain('Overdeck agents must not run git');
    }
  });

  it('still blocks a guarded command aimed at the worktree with -C from outside', () => {
    const result = runGuardedGit(['-C', repo, 'reset', '--hard'], fixtureRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not run git reset --hard');
  });

  it('allows a guarded command aimed elsewhere with -C from inside the worktree', () => {
    const result = runGuardedGit(['-C', fixtureRepo, 'reset', '--hard'], repo);
    expect(result.stderr).not.toContain('Overdeck agents must not run git');
  });
});

describe('git-guard PATH hygiene (PAN-3189)', () => {
  it('drops an inherited guard dir and resolves real git behind it', () => {
    const foreignGuardDir = join(home, 'agents', 'flywheel-orchestrator', 'git-guard');
    mkdirSync(foreignGuardDir, { recursive: true });
    writeFileSync(join(foreignGuardDir, 'git'), '#!/bin/sh\nexit 77\n');
    execFileSync('chmod', ['0755', join(foreignGuardDir, 'git')]);

    const ownGuardDir = join(home, 'agents', 'path-hygiene-test', 'git-guard');
    const script = [
      ...buildGitGuardLines('path-hygiene-test', repo),
      'echo "$PATH"',
    ].join('\n');

    const result = spawnSync('bash', ['-ec', script], {
      cwd: home,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${foreignGuardDir}:${process.env.PATH ?? ''}` },
    });

    expect(result.status).toBe(0);
    const segments = result.stdout.trim().split(':');
    expect(segments).toContain(ownGuardDir);
    expect(segments).not.toContain(foreignGuardDir);
    expect(segments.filter(segment => segment.endsWith('/git-guard'))).toEqual([ownGuardDir]);

    // Real git must resolve past the foreign shim, not into it.
    const shim = execFileSync('cat', [join(ownGuardDir, 'git')], { encoding: 'utf8' });
    expect(shim).not.toContain(foreignGuardDir);
  });
});
