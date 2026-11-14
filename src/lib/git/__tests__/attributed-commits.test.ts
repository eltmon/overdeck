/**
 * PAN-5281: `listAttributedCommits` returns the non-merge commits whose final
 * trailer paragraph names the session, newest first, with per-file status and
 * line counts.
 *
 * Fixture git calls run with an environment isolated from the session running
 * the tests (NFR-3): `*\/git-guard` PATH segments are dropped, the
 * agent/conversation ids are deleted, the shim bypass is on, and identities
 * and dates are fixed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listAttributedCommits } from '../attributed-commits.js';

const fixtureEnv: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':'),
    OVERDECK_PAN_GIT_OP: '1',
    GIT_AUTHOR_NAME: 'attr', GIT_AUTHOR_EMAIL: 'attr@example.test',
    GIT_COMMITTER_NAME: 'attr', GIT_COMMITTER_EMAIL: 'attr@example.test',
    // A global commit.gpgSign=true would make every fixture commit fail without a key.
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgSign', GIT_CONFIG_VALUE_0: 'false',
  };
  delete env.OVERDECK_AGENT_ID;
  delete env.OVERDECK_CONVERSATION;
  return env;
})();

let home: string;
let repo: string;
let clock = 0;
const shas: Record<string, string> = {};

function git(args: string[], cwd = repo): string {
  // Strictly increasing dates keep "newest first" independent of how fast the fixture runs.
  const date = `2026-11-14T10:${String(clock++).padStart(2, '0')}:00Z`;
  return execFileSync('git', args, {
    cwd,
    env: { ...fixtureEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const A_LINES = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'attributed-commits-'));
  repo = join(home, 'repo');
  git(['init', '--quiet', '-b', 'main', repo], home);

  // (1) root commit adding a.txt, attributed to conv-a.
  writeFileSync(join(repo, 'a.txt'), `${A_LINES.join('\n')}\n`);
  git(['add', 'a.txt']);
  git(['commit', '--quiet', '-m', 'one', '--trailer', 'Overdeck-Conversation: conv-a']);
  shas.one = git(['rev-parse', 'HEAD']);

  // (2) no trailer.
  git(['commit', '--quiet', '--allow-empty', '-m', 'two']);

  // (3) attributed to conv-b.
  git(['commit', '--quiet', '--allow-empty', '-m', 'three', '--trailer', 'Overdeck-Conversation: conv-b']);

  // (4) rename a.txt -> b.txt with one edited line, plus a binary file, attributed to conv-a.
  git(['mv', 'a.txt', 'b.txt']);
  writeFileSync(join(repo, 'b.txt'), `${A_LINES.map((l, i) => (i === 4 ? 'line five' : l)).join('\n')}\n`);
  writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255, 0, 3]));
  git(['add', 'b.txt', 'bin.dat']);
  git(['commit', '--quiet', '-m', 'four', '--trailer', 'Overdeck-Conversation: conv-a']);
  shas.four = git(['rev-parse', 'HEAD']);

  // (5) the key line sits in the body; the final trailer paragraph is Signed-off-by.
  git([
    'commit', '--quiet', '--allow-empty',
    '-m', 'five',
    '-m', 'Overdeck-Conversation: conv-a\nmentioned in prose, not a trailer',
    '-m', 'Signed-off-by: x <x@example.test>',
  ]);

  // A --no-ff merge whose own message carries the conv-a trailer.
  git(['checkout', '--quiet', '-b', 'side']);
  git(['commit', '--quiet', '--allow-empty', '-m', 'on side']);
  git(['checkout', '--quiet', 'main']);
  git(['merge', '--quiet', '--no-ff', '-m', 'merge side', '-m', 'Overdeck-Conversation: conv-a', 'side']);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('listAttributedCommits (PAN-5281)', () => {
  it('returns only the matching commits, newest first', async () => {
    const commits = await listAttributedCommits({ repoPath: repo, key: 'Overdeck-Conversation', value: 'conv-a' });
    expect(commits.map((c) => c.subject)).toEqual(['four', 'one']);
    expect(commits.map((c) => c.sha)).toEqual([shas.four, shas.one]);
    expect(commits[0]?.authoredAt).toMatch(/^2026-11-14T10:\d\d:00(Z|\+00:00)$/);
  });

  it('reports renames, counts and binary files', async () => {
    const [four, one] = await listAttributedCommits({ repoPath: repo, key: 'Overdeck-Conversation', value: 'conv-a' });
    expect(four?.files).toEqual(expect.arrayContaining([
      { path: 'b.txt', status: 'R', additions: 1, deletions: 1 },
      { path: 'bin.dat', status: 'A', additions: 0, deletions: 0 },
    ]));
    expect(four?.files).toHaveLength(2);
    expect(one?.files).toEqual([{ path: 'a.txt', status: 'A', additions: 10, deletions: 0 }]);
  });

  it('maxCount counts confirmed matches', async () => {
    const commits = await listAttributedCommits({ repoPath: repo, key: 'Overdeck-Conversation', value: 'conv-a', maxCount: 1 });
    expect(commits.map((c) => c.sha)).toEqual([shas.four]);
  });

  it('matches a key in another case and with whitespace before the colon', async () => {
    const other = join(home, 'key-forms');
    git(['init', '--quiet', '-b', 'main', other], home);
    git(['commit', '--quiet', '--allow-empty', '-m', 'lower', '-m', 'overdeck-conversation : conv-c'], other);
    git(['commit', '--quiet', '--allow-empty', '-m', 'other value', '-m', 'Overdeck-Conversation: conv-cc'], other);
    const commits = await listAttributedCommits({ repoPath: other, key: 'Overdeck-Conversation', value: 'conv-c' });
    expect(commits.map((c) => c.subject)).toEqual(['lower']);
  });

  it('excludes merge commits', async () => {
    const commits = await listAttributedCommits({ repoPath: repo, key: 'Overdeck-Conversation', value: 'conv-a' });
    expect(commits.map((c) => c.subject)).not.toContain('merge side');
  });

  it('returns [] for an empty repository and for an empty value', async () => {
    const empty = join(home, 'empty');
    git(['init', '--quiet', empty], home);
    await expect(listAttributedCommits({ repoPath: empty, key: 'Overdeck-Agent', value: 'agent-x' })).resolves.toEqual([]);
    await expect(listAttributedCommits({ repoPath: repo, key: 'Overdeck-Conversation', value: '' })).resolves.toEqual([]);
  });

  it('rejects for a path that is not a repository', async () => {
    const plain = join(home, 'not-a-repo');
    mkdirSync(plain);
    await expect(listAttributedCommits({ repoPath: plain, key: 'Overdeck-Agent', value: 'agent-x' })).rejects.toThrow();
  });
});
