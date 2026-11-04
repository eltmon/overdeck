/**
 * PAN-5003: a branch that resolved a conflict with main in a merge-main
 * commit (conflict repair, `pan sync-main`) must still merge after main moves
 * on. A plain rebase drops that merge commit and replays the branch's own
 * commit, so the resolved conflict comes back (PR #4997). The merge door
 * catches such a branch up by merging main again.
 *
 * Real git against a local bare remote; no network.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Exit } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebaseFeatureBranch } from '../merge-rebase.js';

const BRANCH = 'feature/pan-5003';
const SHARED = 'architecture.md';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

function commit(cwd: string, file: string, content: string, message: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    git(cwd, 'merge-base', '--is-ancestor', ancestor, descendant);
    return true;
  } catch {
    return false;
  }
}

describe('rebaseFeatureBranch on a branch that merged main (PAN-5003)', () => {
  let root: string;
  let remote: string;
  let work: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rebase-merged-main-'));
    remote = join(root, 'remote.git');
    work = join(root, 'work');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, work);
    git(work, 'config', 'user.name', 't');
    git(work, 'config', 'user.email', 't@t');
    git(work, 'checkout', '-q', '-b', 'main');
    commit(work, SHARED, 'last-verified: 1\n', 'base');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', BRANCH);
    commit(work, SHARED, 'last-verified: branch\n', 'feature edits the shared line');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Main edits the shared line, and the branch resolves it in a merge-main commit. */
  function resolveConflictByMergingMain(): string {
    git(work, 'checkout', '-q', 'main');
    commit(work, SHARED, 'last-verified: main\n', 'main edits the shared line');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', BRANCH);
    try {
      git(work, 'merge', '-q', '--no-edit', 'main');
    } catch { /* the conflict is resolved below */ }
    writeFileSync(join(work, SHARED), 'last-verified: resolved\n');
    git(work, 'add', SHARED);
    git(work, 'commit', '-q', '--no-edit');
    git(work, 'push', '-q', 'origin', BRANCH);
    return git(work, 'rev-parse', 'HEAD');
  }

  function mainMovesOn(file: string, content: string): string {
    git(work, 'checkout', '-q', 'main');
    const head = commit(work, file, content, `main changes ${file}`);
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', BRANCH);
    return head;
  }

  const run = async (expectedHead?: string) => {
    const exit = await Effect.runPromiseExit(
      rebaseFeatureBranch(work, BRANCH, 'main', 'PAN-5003', expectedHead ? { expectedHead } : {}),
    );
    return Exit.isSuccess(exit)
      ? { ok: true as const, newHead: exit.value.newHead!, skipped: exit.value.skipped }
      : { ok: false as const, error: Exit.isFailure(exit) ? JSON.stringify(exit.cause) : '' };
  };

  for (const pinned of [true, false]) {
    const label = pinned ? 'an automatic merge (approved head)' : 'a manual merge';

    it(`${label}: catches up a branch whose conflict a merge-main commit resolved after main moved on`, async () => {
      const approved = resolveConflictByMergingMain();
      const mainHead = mainMovesOn('unrelated.txt', 'unrelated\n');

      const result = await run(pinned ? approved : undefined);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(isAncestor(work, mainHead, result.newHead)).toBe(true);
      expect(isAncestor(work, approved, result.newHead)).toBe(true);
      // The merge-main resolution survives.
      expect(git(work, 'show', `${result.newHead}:${SHARED}`)).toBe('last-verified: resolved');
      expect(git(remote, 'rev-parse', BRANCH)).toBe(result.newHead);
      expect(git(work, 'rev-parse', 'HEAD')).toBe(result.newHead);
      expect(readFileSync(join(work, 'unrelated.txt'), 'utf-8')).toBe('unrelated\n');
      expect(git(work, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
    });

    it(`${label}: still fails a branch that merged main when main's newer change really conflicts`, async () => {
      const approved = resolveConflictByMergingMain();
      mainMovesOn(SHARED, 'last-verified: main again\n');

      const result = await run(pinned ? approved : undefined);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(SHARED);
      expect(git(remote, 'rev-parse', BRANCH)).toBe(approved);
      expect(git(work, 'rev-parse', 'HEAD')).toBe(approved);
      expect(git(work, 'status', '--porcelain')).toBe('');
    });

    it(`${label}: still fails a branch behind main with a real conflict`, async () => {
      git(work, 'push', '-q', 'origin', BRANCH);
      const approved = git(work, 'rev-parse', 'HEAD');
      mainMovesOn(SHARED, 'last-verified: main\n');

      const result = await run(pinned ? approved : undefined);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(SHARED);
      expect(git(remote, 'rev-parse', BRANCH)).toBe(approved);
      expect(git(work, 'status', '--porcelain')).toBe('');
    });
  }

  // Pre-existing behavior, kept as a guard: the issue's proposed ancestor
  // check is the `behind === 0` skip that already exists.
  it('skips a branch that already contains main', async () => {
    const approved = resolveConflictByMergingMain();

    const result = await run(approved);

    expect(result).toMatchObject({ ok: true, newHead: approved, skipped: true });
  });
});
