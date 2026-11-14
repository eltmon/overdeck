/**
 * PAN-5281: the agent git shim adds `Overdeck-Agent: <agentId>` to every
 * `git commit` it passes through — inside the guarded worktree (through the
 * branch check), outside it, and in read-only mode outside the guarded
 * repository — and leaves every other subcommand alone.
 *
 * Every git call here runs with an environment isolated from the session that
 * runs the tests (NFR-3): `*\/git-guard` PATH segments are dropped so "real
 * git" is never the running agent's own shim, the agent/conversation ids are
 * deleted, and author/committer identities are fixed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildGitGuardLines } from '../launcher-git-guard.js';

const AGENT_ID = 'agent-pan-5281-test';

const baseEnv: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':'),
    GIT_AUTHOR_NAME: 'trailer', GIT_AUTHOR_EMAIL: 'trailer@example.test',
    GIT_COMMITTER_NAME: 'trailer', GIT_COMMITTER_EMAIL: 'trailer@example.test',
  };
  delete env.OVERDECK_AGENT_ID;
  delete env.OVERDECK_CONVERSATION;
  return env;
})();
const realEnv: NodeJS.ProcessEnv = { ...baseEnv, OVERDECK_PAN_GIT_OP: '1' };
const shimEnv: NodeJS.ProcessEnv = { ...baseEnv, OVERDECK_PAN_GIT_OP: '' };

let home: string;
let roHome: string;
let repo: string;
let shim: string;
let roShim: string;
let oldGitShim: string;
let previousHome: string | undefined;
let repoCounter = 0;

interface RunResult {
  status: number;
  stderr: string;
}

function run(shimPath: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = shimEnv): RunResult {
  const result = spawnSync(shimPath, args, { cwd, encoding: 'utf8', env });
  return { status: result.status ?? 1, stderr: result.stderr ?? '' };
}

function realGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, env: realEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function newRepo(dir = join(home, `fixture-${++repoCounter}`)): string {
  execFileSync('git', ['init', '--quiet', '-b', 'main', dir], { env: realEnv, stdio: 'ignore' });
  return dir;
}

function agentTrailers(cwd: string, rev = 'HEAD'): string[] {
  const out = realGit(['log', '-1', '--format=%(trailers:key=Overdeck-Agent,valueonly)', rev], cwd);
  return out === '' ? [] : out.split('\n');
}

function materialize(lines: string[], env: NodeJS.ProcessEnv = realEnv): void {
  execFileSync('bash', ['-ec', lines.join('\n')], { cwd: home, env, stdio: 'ignore' });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'git-guard-trailer-'));
  roHome = mkdtempSync(join(tmpdir(), 'git-guard-trailer-ro-'));
  previousHome = process.env.OVERDECK_HOME;

  repo = newRepo(join(home, 'scratch-repo'));

  process.env.OVERDECK_HOME = home;
  materialize(buildGitGuardLines(AGENT_ID, repo));
  shim = join(home, 'agents', AGENT_ID, 'git-guard', 'git');

  // A git that predates `commit --trailer`: its `commit -h` usage omits it.
  const realGitPath = execFileSync('sh', ['-c', 'command -v git'], { env: realEnv, encoding: 'utf8' }).trim();
  const fakeBin = join(home, 'old-git-bin');
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, 'git'), [
    '#!/bin/sh',
    'if [ "$1" = "commit" ] && [ "$2" = "-h" ]; then',
    '  echo "usage: git commit [-a] [-m <msg>]"',
    '  exit 129',
    'fi',
    `exec '${realGitPath}' "$@"`,
    '',
  ].join('\n'));
  chmodSync(join(fakeBin, 'git'), 0o755);
  materialize(buildGitGuardLines('old-git-5281', repo), { ...realEnv, PATH: `${fakeBin}:${realEnv.PATH}` });
  oldGitShim = join(home, 'agents', 'old-git-5281', 'git-guard', 'git');

  process.env.OVERDECK_HOME = roHome;
  materialize(buildGitGuardLines(AGENT_ID, repo, 'read-only'));
  roShim = join(roHome, 'agents', AGENT_ID, 'git-guard', 'git');
  process.env.OVERDECK_HOME = home;
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(roHome, { recursive: true, force: true });
});

describe('agent git shim trailer (PAN-5281)', () => {
  it('adds an Overdeck-Agent trailer to git commit in the guarded worktree', () => {
    const result = run(shim, ['commit', '--allow-empty', '-m', 'msg'], repo);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(agentTrailers(repo)).toEqual([AGENT_ID]);
  });

  it('adds the trailer outside the guarded worktree', () => {
    const fixture = newRepo();
    const result = run(shim, ['-C', fixture, 'commit', '--allow-empty', '-m', 'msg'], home);
    expect(result.status).toBe(0);
    expect(agentTrailers(fixture)).toEqual([AGENT_ID]);
  });

  it('keeps -m values with spaces and paths after --', () => {
    const fixture = newRepo();
    writeFileSync(join(fixture, 'a.txt'), 'a\n');
    writeFileSync(join(fixture, 'b.txt'), 'b\n');
    realGit(['add', 'a.txt', 'b.txt'], fixture);
    realGit(['commit', '-m', 'base'], fixture);
    writeFileSync(join(fixture, 'a.txt'), 'a2\n');
    writeFileSync(join(fixture, 'b.txt'), 'b2\n');

    const result = run(shim, ['commit', '-m', 'two words', '--', 'a.txt'], fixture);
    expect(result.status).toBe(0);
    expect(realGit(['log', '-1', '--format=%s'], fixture)).toBe('two words');
    expect(realGit(['show', '--name-only', '--format=', 'HEAD'], fixture)).toBe('a.txt');
    expect(agentTrailers(fixture)).toEqual([AGENT_ID]);
  });

  it('inserts after the subcommand when -C names a directory called commit', () => {
    const parent = join(home, 'parent-of-commit');
    mkdirSync(parent);
    const commitRepo = newRepo(join(parent, 'commit'));
    const result = run(shim, ['-C', 'commit', 'commit', '--allow-empty', '-m', 'x'], parent);
    expect(result.status).toBe(0);
    expect(realGit(['log', '-1', '--format=%s'], commitRepo)).toBe('x');
    expect(agentTrailers(commitRepo)).toEqual([AGENT_ID]);
  });

  it('never duplicates the trailer on amend', () => {
    const fixture = newRepo();
    expect(run(shim, ['commit', '--allow-empty', '-m', 'msg'], fixture).status).toBe(0);
    expect(run(shim, ['commit', '--amend', '--no-edit', '--allow-empty'], fixture).status).toBe(0);
    realGit(['commit', '--amend', '--no-edit', '--allow-empty', '--trailer', 'Overdeck-Conversation: c'], fixture);
    expect(run(shim, ['commit', '--amend', '--no-edit', '--allow-empty'], fixture).status).toBe(0);
    expect(agentTrailers(fixture)).toEqual([AGENT_ID]);
  });

  it('adds no trailer with OVERDECK_PAN_GIT_OP=1', () => {
    const fixture = newRepo();
    const result = run(shim, ['commit', '--allow-empty', '-m', 'msg'], fixture, realEnv);
    expect(result.status).toBe(0);
    expect(agentTrailers(fixture)).toEqual([]);
  });

  it('does not touch git merge', () => {
    const fixture = newRepo();
    realGit(['commit', '--allow-empty', '-m', 'base'], fixture);
    realGit(['branch', 'side'], fixture);
    realGit(['commit', '--allow-empty', '-m', 'on main'], fixture);
    realGit(['checkout', '--quiet', 'side'], fixture);
    realGit(['commit', '--allow-empty', '-m', 'on side'], fixture);
    realGit(['checkout', '--quiet', 'main'], fixture);

    const result = run(shim, ['merge', '--no-ff', '-m', 'm', 'side'], fixture);
    expect(result.status).toBe(0);
    expect(realGit(['log', '-1', '--format=%s'], fixture)).toBe('m');
    expect(agentTrailers(fixture)).toEqual([]);
  });

  it('adds no trailer when git lacks --trailer', () => {
    const fixture = newRepo();
    const result = run(oldGitShim, ['commit', '--allow-empty', '-m', 'msg'], fixture);
    expect(result.status).toBe(0);
    expect(realGit(['log', '-1', '--format=%s'], fixture)).toBe('msg');
    expect(agentTrailers(fixture)).toEqual([]);
  });

  it('read-only mode stamps a commit in an unrelated repository', () => {
    const fixture = newRepo();
    const allowed = run(roShim, ['commit', '--allow-empty', '-m', 'msg'], fixture);
    expect(allowed.status).toBe(0);
    expect(agentTrailers(fixture)).toEqual([AGENT_ID]);

    const refused = run(roShim, ['commit', '--allow-empty', '-m', 'msg'], repo);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('This worker is read-only: git commit is blocked');
  });
});
