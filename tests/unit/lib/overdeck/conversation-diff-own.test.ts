/**
 * PAN-5418: buildOwnPatches / ownFileChanges against real temp git repos.
 *
 * git runs isolated from the session running the tests: the git-guard PATH
 * segments are dropped and the agent/conversation ids deleted, so fixture
 * commits carry nothing the test did not write. Every fixture commit gets an
 * explicit, strictly increasing author/committer date so D3 order is fixed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isolated = vi.hoisted(() => {
  const saved = {
    PATH: process.env.PATH,
    OVERDECK_AGENT_ID: process.env.OVERDECK_AGENT_ID,
    OVERDECK_CONVERSATION: process.env.OVERDECK_CONVERSATION,
  };
  process.env.PATH = (process.env.PATH ?? '').split(':').filter((s) => !s.endsWith('/git-guard')).join(':');
  delete process.env.OVERDECK_AGENT_ID;
  delete process.env.OVERDECK_CONVERSATION;
  return { saved };
});

import type { ChangeCommit, ChangedFile, ConversationChanges, UncommittedFile } from '@overdeck/contracts';

import {
  buildOwnPatches,
  ownFileChanges,
  UNCOMMITTED_SECTION_SHA,
} from '../../../../src/lib/overdeck/conversation-diff-own.js';

const ZERO_PREAMBLE = `From ${UNCOMMITTED_SECTION_SHA} `;

let repo: string;
let clock: number;

function git(args: string[]): string {
  const iso = new Date(clock).toISOString();
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
}

/** Commits everything staged-or-not with a strictly later date than the last commit; returns the sha and its date. */
function commit(subject: string): { sha: string; authoredAt: string } {
  clock += 60_000;
  git(['add', '-A']);
  git(['commit', '-q', '-m', subject]);
  return { sha: git(['rev-parse', 'HEAD']).trim(), authoredAt: new Date(clock).toISOString() };
}

function lines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}\n`).join('');
}

function changeCommit(ref: { sha: string; authoredAt: string }, subject: string, files: ChangedFile[]): ChangeCommit {
  return {
    sha: ref.sha,
    shortSha: ref.sha.slice(0, 7),
    subject,
    authoredAt: ref.authoredAt,
    pushed: false,
    attribution: 'trailer',
    files,
  };
}

function uncommittedFile(file: ChangedFile): UncommittedFile {
  return { ...file, attribution: 'file', turnIds: [] };
}

/** ConversationChanges with commits given oldest first (stored newest first, as the Changes API does). */
function changesOf(commits: ChangeCommit[], uncommitted: UncommittedFile[] = []): ConversationChanges {
  return {
    conversation: 'conv-test',
    repoRoot: repo,
    rootId: null,
    branch: 'main',
    scope: 'conversation',
    uncommitted,
    commits: [...commits].reverse(),
    totals: { files: 0, additions: 0, deletions: 0, commitsPushed: 0, commitsLocal: 0, uncommittedFiles: 0 },
  };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pan-5418-own-'));
  clock = Date.parse('2026-01-01T00:00:00Z');
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'x.txt'), 'old\nkeep\n');
  commit('base');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

afterAll(() => {
  for (const [key, value] of Object.entries(isolated.saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('buildOwnPatches (PAN-5418)', () => {
  it('combined: one attributed commit then a foreign 50-line commit', async () => {
    writeFileSync(join(repo, 'x.txt'), 'new\nkeep\n');
    const own = commit('own one-line change');
    writeFileSync(join(repo, 'x.txt'), `new\nkeep\n${lines('foreign', 50)}`);
    commit('foreign 50 lines');

    const changes = changesOf([
      changeCommit(own, 'own one-line change', [{ path: 'x.txt', status: 'M', additions: 1, deletions: 1 }]),
    ]);
    const { plain, sections } = await buildOwnPatches(repo, changes, ['x.txt']);

    expect(sections).toEqual([]);
    expect(plain).toHaveLength(1);
    expect(plain[0]).toContain('-old');
    expect(plain[0]).toContain('+new');
    expect(plain[0]).not.toContain('foreign-');
  });

  it('sections: a foreign commit between two attributed commits', async () => {
    writeFileSync(join(repo, 'x.txt'), 'first\nkeep\n');
    const a = commit('own first');
    writeFileSync(join(repo, 'x.txt'), `first\nkeep\n${lines('foreign', 5)}`);
    commit('foreign between');
    writeFileSync(join(repo, 'x.txt'), `first\nsecond\n${lines('foreign', 5)}`);
    const b = commit('own second');

    const changes = changesOf([
      changeCommit(a, 'own first', [{ path: 'x.txt', status: 'M', additions: 1, deletions: 1 }]),
      changeCommit(b, 'own second', [{ path: 'x.txt', status: 'M', additions: 1, deletions: 1 }]),
    ]);
    const { plain, sections } = await buildOwnPatches(repo, changes, ['x.txt']);

    expect(plain).toEqual([]);
    expect(sections).toHaveLength(2);
    expect(sections[0].startsWith(`From ${a.sha} `)).toBe(true);
    expect(sections[1].startsWith(`From ${b.sha} `)).toBe(true);
    expect(sections[0]).toContain('Subject: own first');
    expect(sections[0]).toContain('+first');
    expect(sections[1]).toContain('+second');
    for (const section of sections) expect(section).not.toMatch(/^\+foreign-/m);
  });

  it('uncommitted edit on top of a later foreign commit', async () => {
    writeFileSync(join(repo, 'x.txt'), 'new\nkeep\n');
    const own = commit('own commit');
    writeFileSync(join(repo, 'x.txt'), `new\nkeep\n${lines('foreign', 10)}`);
    commit('foreign after');
    writeFileSync(join(repo, 'x.txt'), `new\nedited\n${lines('foreign', 10)}`);

    const changes = changesOf(
      [changeCommit(own, 'own commit', [{ path: 'x.txt', status: 'M', additions: 1, deletions: 1 }])],
      [uncommittedFile({ path: 'x.txt', status: 'M', additions: 1, deletions: 1 })],
    );
    const { plain, sections } = await buildOwnPatches(repo, changes, ['x.txt']);

    expect(plain).toEqual([]);
    expect(sections).toHaveLength(2);
    expect(sections[0].startsWith(`From ${own.sha} `)).toBe(true);
    expect(sections[1].startsWith(ZERO_PREAMBLE)).toBe(true);
    expect(sections[1]).toContain('Subject: Uncommitted changes');
    expect(sections[1]).toContain('+edited');
    for (const section of sections) expect(section).not.toMatch(/^\+foreign-/m);
  });

  it('uncommitted only', async () => {
    writeFileSync(join(repo, 'x.txt'), 'old\nchanged\n');
    const changes = changesOf([], [uncommittedFile({ path: 'x.txt', status: 'M', additions: 1, deletions: 1 })]);
    const { plain, sections } = await buildOwnPatches(repo, changes, ['x.txt']);

    expect(sections).toEqual([]);
    expect(plain).toEqual([git(['diff', '--patch', '--minimal', '--no-color', 'HEAD', '--', 'x.txt'])]);
  });

  it('rename uses sections with both paths', async () => {
    renameSync(join(repo, 'x.txt'), join(repo, 'y.txt'));
    const moved = commit('rename x to y');

    const changes = changesOf([
      changeCommit(moved, 'rename x to y', [{ path: 'y.txt', oldPath: 'x.txt', status: 'R', additions: 0, deletions: 0 }]),
    ]);
    const { plain, sections } = await buildOwnPatches(repo, changes, ['y.txt']);

    expect(plain).toEqual([]);
    expect(sections).toHaveLength(1);
    expect(sections[0].startsWith(`From ${moved.sha} `)).toBe(true);
    expect(sections[0]).toContain('rename from x.txt');
    expect(sections[0]).toContain('rename to y.txt');
  });

  it('ownFileChanges sums and kind', () => {
    const t = (minutes: number) => ({ sha: String(minutes).repeat(40).slice(0, 40), authoredAt: new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString() });
    const changes = changesOf([
      changeCommit(t(1), 'one', [
        { path: 'sum.txt', status: 'M', additions: 1, deletions: 1 },
        { path: 'created.txt', status: 'A', additions: 2, deletions: 0 },
        { path: 'deleted.txt', status: 'M', additions: 1, deletions: 0 },
      ]),
      changeCommit(t(2), 'two', [
        { path: 'sum.txt', status: 'M', additions: 3, deletions: 0 },
        { path: 'created.txt', status: 'M', additions: 1, deletions: 1 },
        { path: 'deleted.txt', status: 'D', additions: 0, deletions: 3 },
      ]),
    ]);
    const files = ownFileChanges(changes);

    expect(files.get('sum.txt')).toEqual({ path: 'sum.txt', kind: 'M', additions: 4, deletions: 1 });
    expect(files.get('created.txt')?.kind).toBe('A');
    expect(files.get('deleted.txt')?.kind).toBe('D');
    expect(ownFileChanges(null).size).toBe(0);
  });

  it('unresolvable sha is skipped', async () => {
    const changes = changesOf([
      changeCommit({ sha: 'f'.repeat(40), authoredAt: new Date(clock + 60_000).toISOString() }, 'rewritten away', [
        { path: 'x.txt', status: 'M', additions: 1, deletions: 1 },
      ]),
    ]);
    await expect(buildOwnPatches(repo, changes, ['x.txt'])).resolves.toEqual({ plain: [], sections: [] });
  });
});
