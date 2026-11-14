/**
 * PAN-5281: conversations get a trailer-only `git` shim beside their `gh`
 * shim. It adds `Overdeck-Conversation: <id>` to `git commit` and refuses
 * nothing — conversations are operator sessions, so rebase, stash and
 * reset --hard pass straight through. An agent launched from inside a
 * conversation drops the conversation's guard dir and writes only its own
 * `Overdeck-Agent` trailer.
 *
 * Every git call runs with an environment isolated from the session running
 * the tests (NFR-3): `*\/git-guard` PATH segments are dropped, the
 * agent/conversation ids are deleted, and author/committer identities are fixed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildConversationShimLines, buildGitGuardLines } from '../launcher-git-guard.js';

const CONVERSATION_ID = 'conv-5281-test';

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
let shim: string;
let previousHome: string | undefined;
let repoCounter = 0;

interface RunResult {
  status: number;
  stderr: string;
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = shimEnv): RunResult {
  const result = spawnSync(shim, args, { cwd, encoding: 'utf8', env });
  return { status: result.status ?? 1, stderr: result.stderr ?? '' };
}

function realGit(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, env: realEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function newRepo(): string {
  const dir = join(home, `fixture-${++repoCounter}`);
  execFileSync('git', ['init', '--quiet', '-b', 'main', dir], { env: realEnv, stdio: 'ignore' });
  return dir;
}

function trailerValues(key: string, cwd: string): string[] {
  const out = realGit(['log', '-1', `--format=%(trailers:key=${key},valueonly)`], cwd);
  return out === '' ? [] : out.split('\n');
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'conversation-git-shim-'));
  previousHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = home;
  execFileSync('bash', ['-ec', buildConversationShimLines(CONVERSATION_ID, false).join('\n')], {
    cwd: home,
    env: realEnv,
    stdio: 'ignore',
  });
  shim = join(home, 'conversations', CONVERSATION_ID, 'git-guard', 'git');
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe('conversation git shim (PAN-5281)', () => {
  it('adds an Overdeck-Conversation trailer to git commit', () => {
    const fixture = newRepo();
    const result = run(['commit', '--allow-empty', '-m', 'x'], fixture);
    expect(result.status).toBe(0);
    expect(trailerValues('Overdeck-Conversation', fixture)).toEqual([CONVERSATION_ID]);
  });

  it('allows git rebase, git stash and git reset --hard', () => {
    const fixture = newRepo();
    writeFileSync(join(fixture, 'a.txt'), 'a\n');
    realGit(['add', 'a.txt'], fixture);
    realGit(['commit', '-m', 'base'], fixture);
    realGit(['branch', 'side'], fixture);
    writeFileSync(join(fixture, 'main.txt'), 'main\n');
    realGit(['add', 'main.txt'], fixture);
    realGit(['commit', '-m', 'on main'], fixture);
    realGit(['checkout', '--quiet', 'side'], fixture);
    writeFileSync(join(fixture, 'side.txt'), 'side\n');
    realGit(['add', 'side.txt'], fixture);
    realGit(['commit', '-m', 'on side'], fixture);

    writeFileSync(join(fixture, 'a.txt'), 'changed\n');
    const stash = run(['stash', 'push'], fixture);
    expect(stash.stderr).not.toContain('Overdeck');
    expect(stash.status).toBe(0);

    writeFileSync(join(fixture, 'a.txt'), 'changed again\n');
    const reset = run(['reset', '--hard', 'HEAD'], fixture);
    expect(reset.stderr).not.toContain('Overdeck');
    expect(reset.status).toBe(0);

    const rebase = run(['rebase', 'main'], fixture);
    expect(rebase.stderr).not.toContain('Overdeck');
    expect(rebase.status).toBe(0);
    expect(realGit(['log', '-1', '--format=%s', 'HEAD~1'], fixture)).toBe('on main');
  });

  it('adds no trailer with OVERDECK_PAN_GIT_OP=1', () => {
    const fixture = newRepo();
    const result = run(['commit', '--allow-empty', '-m', 'x'], fixture, realEnv);
    expect(result.status).toBe(0);
    expect(trailerValues('Overdeck-Conversation', fixture)).toEqual([]);
  });

  it('an agent inside a conversation writes only Overdeck-Agent', () => {
    const fixture = newRepo();
    const script = [
      ...buildConversationShimLines('conv-outer-5281', false),
      ...buildGitGuardLines('agent-in-conv', fixture),
      'export OVERDECK_PAN_GIT_OP=',
      `git -C '${fixture}' commit --allow-empty -m x`,
    ].join('\n');
    execFileSync('bash', ['-ec', script], { cwd: home, env: realEnv, stdio: 'ignore' });
    expect(trailerValues('Overdeck-Agent', fixture)).toEqual(['agent-in-conv']);
    expect(trailerValues('Overdeck-Conversation', fixture)).toEqual([]);
  });
});
