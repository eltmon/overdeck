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

describe('read-only mode (PAN-3920 workers)', () => {
  let readOnlyGit: string;
  let readOnlyRepo: string;
  const identityEnv = {
    OVERDECK_PAN_GIT_OP: '',
    GIT_AUTHOR_NAME: 'guard', GIT_AUTHOR_EMAIL: 'guard@example.test',
    GIT_COMMITTER_NAME: 'guard', GIT_COMMITTER_EMAIL: 'guard@example.test',
  };

  function runShim(shim: string, args: string[], cwd: string): GuardRunResult {
    const result = spawnSync(shim, args, { cwd, encoding: 'utf8', env: { ...process.env, ...identityEnv } });
    return { status: result.status ?? 1, stderr: result.stderr ?? '' };
  }

  beforeAll(() => {
    readOnlyRepo = join(home, 'read-only-repo');
    execFileSync('git', ['init', '--quiet', readOnlyRepo], { stdio: 'ignore' });
    execFileSync('bash', ['-ec', buildGitGuardLines('read-only-test', readOnlyRepo, 'read-only').join('\n')], {
      cwd: home,
      stdio: 'ignore',
    });
    readOnlyGit = join(home, 'agents', 'read-only-test', 'git-guard', 'git');
  });

  it('lets git status through', () => {
    expect(runShim(readOnlyGit, ['status'], readOnlyRepo).status).toBe(0);
  });

  it('refuses git commit with a read-only message', () => {
    const result = runShim(readOnlyGit, ['commit', '--allow-empty', '-m', 'x'], readOnlyRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('read-only');
  });

  it('refuses git push', () => {
    const result = runShim(readOnlyGit, ['push', 'origin', 'HEAD'], readOnlyRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('read-only');
  });

  it('refuses git checkout -b', () => {
    const result = runShim(readOnlyGit, ['checkout', '-b', 'x'], readOnlyRepo);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('read-only');
  });

  it('lets git commit through inside a different repository', () => {
    const result = runShim(readOnlyGit, ['commit', '--allow-empty', '-m', 'x'], fixtureRepo);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('read-only');
  });

  it('leaves default mode unchanged: commit passes in the guarded worktree', () => {
    execFileSync('bash', ['-ec', buildGitGuardLines('default-mode-test', readOnlyRepo).join('\n')], {
      cwd: home,
      stdio: 'ignore',
    });
    const shim = join(home, 'agents', 'default-mode-test', 'git-guard', 'git');
    expect(runShim(shim, ['commit', '--allow-empty', '-m', 'y'], readOnlyRepo).status).toBe(0);
  });
});

describe('read-only mode guards the whole repository (review of #4027)', () => {
  let shim: string;
  let primary: string;
  let workspace: string;
  const env = {
    ...process.env,
    OVERDECK_PAN_GIT_OP: '',
    GIT_AUTHOR_NAME: 'guard', GIT_AUTHOR_EMAIL: 'guard@example.test',
    GIT_COMMITTER_NAME: 'guard', GIT_COMMITTER_EMAIL: 'guard@example.test',
  };

  function run(args: string[], cwd: string, extraEnv: Record<string, string> = {}): GuardRunResult {
    const result = spawnSync(shim, args, { cwd, encoding: 'utf8', env: { ...env, ...extraEnv } });
    return { status: result.status ?? 1, stderr: result.stderr ?? '' };
  }

  function realGit(args: string[], cwd: string): string {
    return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }

  beforeAll(() => {
    primary = join(home, 'ro-primary');
    execFileSync('git', ['init', '--quiet', '-b', 'main', primary], { stdio: 'ignore' });
    writeFileSync(join(primary, 'README.md'), 'x\n');
    realGit(['add', 'README.md'], primary);
    realGit(['commit', '--quiet', '-m', 'init'], primary);
    workspace = join(primary, 'workspaces', 'feature-pan-1');
    realGit(['worktree', 'add', '--quiet', '-b', 'feature/pan-1', workspace, 'main'], primary);
    mkdirSync(join(workspace, 'src'), { recursive: true });
    execFileSync('bash', ['-ec', buildGitGuardLines('ro-repo-test', workspace, 'read-only').join('\n')], {
      cwd: home,
      stdio: 'ignore',
    });
    shim = join(home, 'agents', 'ro-repo-test', 'git-guard', 'git');
  });

  it('refuses a commit in the primary checkout reached with cd ..', () => {
    const result = run(['commit', '--allow-empty', '-m', 'x'], join(workspace, '..'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('read-only');
  });

  it('refuses git -C .. commit from inside the workspace', () => {
    expect(run(['-C', '..', 'commit', '--allow-empty', '-m', 'x'], workspace).status).toBe(1);
  });

  it('refuses git -C <primary> update-ref', () => {
    expect(run(['-C', primary, 'update-ref', 'refs/heads/sneaky', 'HEAD'], home).status).toBe(1);
    expect(() => realGit(['rev-parse', '--verify', '--quiet', 'refs/heads/sneaky'], primary)).toThrow();
  });

  it('refuses a commit from a subdirectory and through GIT_DIR or --git-dir', () => {
    expect(run(['commit', '--allow-empty', '-m', 'x'], join(workspace, 'src')).status).toBe(1);
    expect(run(['commit', '--allow-empty', '-m', 'x'], home, { GIT_DIR: join(primary, '.git') }).status).toBe(1);
    expect(run(['--git-dir', join(primary, '.git'), 'update-ref', 'refs/heads/y', 'HEAD'], home).status).toBe(1);
  });

  it('refuses config writes, remote add and fetch', () => {
    expect(run(['config', 'core.hooksPath', '/tmp/hooks'], workspace).status).toBe(1);
    expect(run(['remote', 'add', 'evil', '/tmp/evil'], workspace).status).toBe(1);
    expect(run(['fetch', primary, 'HEAD:refs/heads/x'], workspace).status).toBe(1);
    expect(() => realGit(['rev-parse', '--verify', '--quiet', 'refs/heads/x'], primary)).toThrow();
    expect(() => realGit(['config', '--get', 'core.hooksPath'], workspace)).toThrow();
  });

  it('allows config reads, remote listing and branch listing', () => {
    expect(run(['config', '--list'], workspace).status).toBe(0);
    expect(run(['config', '--get', 'core.bare'], workspace).status).toBe(0);
    expect(run(['remote'], workspace).status).toBe(0);
    expect(run(['remote', '-v'], workspace).status).toBe(0);
    expect(run(['branch', '--show-current'], workspace).status).toBe(0);
    expect(run(['branch'], workspace).status).toBe(0);
    expect(run(['branch', '-a', '-v'], workspace).status).toBe(0);
    expect(run(['branch', '--list', 'feature/*'], workspace).status).toBe(0);
    expect(run(['log', '--oneline', '-1'], join(workspace, '..')).status).toBe(0);
  });

  // Re-review of #4027: git stops parsing options at the first plain argument
  // and accepts unique prefixes of long options, so these all used to get through.
  it('refuses a config write with a read flag after the key', () => {
    expect(run(['config', 'foo.bar', '1', '--list'], workspace).status).toBe(1);
    expect(run(['config', '--get', 'foo.bar', '--add', 'x'], workspace).status).toBe(1);
    expect(run(['config', '--list', '--unset', 'core.bare'], workspace).status).toBe(1);
    expect(run(['config', 'set', 'foo.bar', '1'], workspace).status).toBe(1);
    expect(() => realGit(['config', '--get', 'foo.bar'], workspace)).toThrow();
  });

  it('refuses branch long-option prefixes of write options', () => {
    expect(run(['branch', '--set-upstream-t=main'], workspace).status).toBe(1);
    expect(run(['branch', '--unset'], workspace).status).toBe(1);
    expect(run(['branch', '--edit'], workspace).status).toBe(1);
    expect(run(['branch', '--del', 'main'], workspace).status).toBe(1);
  });

  it('allows the exact branch listing options', () => {
    expect(run(['branch', '--contains', 'HEAD'], workspace).status).toBe(0);
    expect(run(['branch', '--merged', 'main', '-v'], workspace).status).toBe(0);
    expect(run(['branch', '--sort=-committerdate', '--format=%(refname:short)'], workspace).status).toBe(0);
  });

  it('allows only exact remote read forms', () => {
    expect(run(['remote', 'rename', 'a', 'b'], workspace).status).toBe(1);
    expect(run(['remote', 'set-url', 'a', 'b'], workspace).status).toBe(1);
    expect(run(['remote', 'show', '--foo'], workspace).status).toBe(1);
    expect(run(['remote', '-vv', 'add', 'x', 'y'], workspace).status).toBe(1);
  });

  it('refuses branch creation and deletion', () => {
    expect(run(['branch', 'newbranch'], workspace).status).toBe(1);
    expect(run(['branch', '-D', 'main'], workspace).status).toBe(1);
  });

  it('lets writes through in an unrelated repository', () => {
    expect(run(['commit', '--allow-empty', '-m', 'x'], fixtureRepo).status).toBe(0);
  });
});
