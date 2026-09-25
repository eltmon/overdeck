/**
 * #4066 review: an automatic merge rebases exactly its approved head. A
 * commit the work agent makes in the shared worktree, or pushes to the PR
 * branch, after the approval must never ride along into the merge.
 *
 * Real git against a local bare remote; no network.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Exit } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rebaseFeatureBranch } from '../merge-rebase.js';

const BRANCH = 'feature/pan-1';

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

function commit(cwd: string, file: string, message: string): string {
  writeFileSync(join(cwd, file), `${message}\n`);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

describe('rebaseFeatureBranch with an approved head (#4066 review)', () => {
  let root: string;
  let remote: string;
  let work: string;
  let approved: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rebase-pinned-'));
    remote = join(root, 'remote.git');
    work = join(root, 'work');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, work);
    // rebaseFeatureBranch runs git with the process env: give the clone an identity.
    git(work, 'config', 'user.name', 't');
    git(work, 'config', 'user.email', 't@t');
    git(work, 'checkout', '-q', '-b', 'main');
    commit(work, 'base.txt', 'base');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', BRANCH);
    approved = commit(work, 'feature.txt', 'feature');
    git(work, 'push', '-q', 'origin', BRANCH);
    // main moves on, so the feature branch needs a rebase.
    git(work, 'checkout', '-q', 'main');
    commit(work, 'main2.txt', 'main moves');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', BRANCH);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const run = async (expectedHead?: string): Promise<{ ok: boolean; newHead?: string }> => {
    const exit = await Effect.runPromiseExit(
      rebaseFeatureBranch(work, BRANCH, 'main', 'PAN-1', expectedHead ? { expectedHead } : {}),
    );
    return Exit.isSuccess(exit) ? { ok: true, newHead: exit.value.newHead } : { ok: false };
  };

  it('rebases the approved head and pushes that rebase, and nothing else', async () => {
    const result = await run(approved);
    expect(result.ok).toBe(true);
    const newHead = result.newHead!;
    expect(git(work, 'rev-parse', `${newHead}^`)).toBe(git(work, 'rev-parse', 'origin/main'));
    expect(git(remote, 'rev-parse', BRANCH)).toBe(newHead);
  });

  it('refuses when the worktree holds a commit made after the approval', async () => {
    commit(work, 'unreviewed.txt', 'unreviewed local commit');
    const result = await run(approved);
    expect(result.ok).toBe(false);
    // Nothing was pushed: the remote branch is still the approved head.
    expect(git(remote, 'rev-parse', BRANCH)).toBe(approved);
  });

  it('refuses to overwrite a push that landed on the PR branch after the approval', async () => {
    // Another clone pushes an unreviewed commit to the PR branch.
    const other = join(root, 'other');
    git(root, 'clone', '-q', '-b', BRANCH, remote, other);
    const pushed = commit(other, 'pushed.txt', 'unreviewed push');
    git(other, 'push', '-q', 'origin', BRANCH);

    const result = await run(approved);
    expect(result.ok).toBe(false);
    expect(git(remote, 'rev-parse', BRANCH)).toBe(pushed);
  });

  it('without an approved head, keeps rebasing whatever the worktree holds (manual merges)', async () => {
    commit(work, 'local.txt', 'local commit');
    const result = await run();
    expect(result.ok).toBe(true);
  });
});
