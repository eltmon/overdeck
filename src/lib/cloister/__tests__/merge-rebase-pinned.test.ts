/**
 * #4066 review: an automatic merge rebases exactly its approved head, in a
 * server-owned detached worktree. A commit the work agent makes in its own
 * worktree, before, during or after the rebase, or pushes to the PR branch
 * after the approval, must never ride along into the merge.
 *
 * Real git against a local bare remote; no network.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    // Local verification runs in the workspace, so it is moved to that commit.
    expect(git(work, 'rev-parse', 'HEAD')).toBe(newHead);
    expect(git(work, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
  });

  it('refuses when the worktree holds a commit made after the approval', async () => {
    commit(work, 'unreviewed.txt', 'unreviewed local commit');
    const result = await run(approved);
    expect(result.ok).toBe(false);
    // Nothing was pushed: the remote branch is still the approved head.
    expect(git(remote, 'rev-parse', BRANCH)).toBe(approved);
  });

  it('never pushes or merges a commit the work agent makes in its workspace during the rebase', async () => {
    // The work agent commits in its own workspace the moment the rebase
    // finishes (a post-rewrite hook fires right after the rebase rewrites the
    // branch, before the server reads back the head it pushes). The hook runs
    // wherever the rebase ran, so it commits into the workspace explicitly.
    const hook = join(work, '.git', 'hooks', 'post-rewrite');
    writeFileSync(hook, [
      '#!/bin/sh',
      'unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX',
      `cd '${work}' || exit 0`,
      'echo agent > agent.txt',
      'git add agent.txt',
      'git -c user.name=t -c user.email=t@t commit -q -m "agent commit during the rebase"',
      'exit 0',
      '',
    ].join('\n'));
    chmodSync(hook, 0o755);

    const result = await run(approved);

    const remoteHead = git(remote, 'rev-parse', BRANCH);
    const pushedFiles = git(remote, 'ls-tree', '--name-only', remoteHead).split('\n');
    expect(pushedFiles).not.toContain('agent.txt');
    if (result.ok) {
      // What gets merged is the pin, newHead: the approved commit rebased, alone.
      expect(git(remote, 'ls-tree', '--name-only', result.newHead!).split('\n')).not.toContain('agent.txt');
      expect(git(remote, 'rev-parse', `${result.newHead!}^`)).toBe(git(remote, 'rev-parse', 'main'));
      expect(remoteHead).toBe(result.newHead);
    } else {
      expect(remoteHead).toBe(approved);
    }
    // The server's rebase worktree is always removed.
    expect(git(work, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
  });

  it('removes its rebase worktree when the rebase conflicts', async () => {
    git(work, 'checkout', '-q', 'main');
    writeFileSync(join(work, 'feature.txt'), 'main edits the same file\n');
    git(work, 'add', 'feature.txt');
    git(work, 'commit', '-q', '-m', 'conflicting main change');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', BRANCH);

    const result = await run(approved);
    expect(result.ok).toBe(false);
    expect(git(remote, 'rev-parse', BRANCH)).toBe(approved);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(approved);
    expect(git(work, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
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

  it('moves the worktree back to the approved head when the push is rejected', async () => {
    // The approved head is still the PR branch when the server checks, but a
    // push lands between the rebase and the server's push, so the lease fails.
    const other = join(root, 'other');
    git(root, 'clone', '-q', '-b', BRANCH, remote, other);
    commit(other, 'pushed.txt', 'push during the rebase');
    const hook = join(work, '.git', 'hooks', 'post-rewrite');
    writeFileSync(hook, [
      '#!/bin/sh',
      'unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_PREFIX',
      `cd '${other}' && git push -q origin ${BRANCH}`,
      'exit 0',
      '',
    ].join('\n'));
    chmodSync(hook, 0o755);

    const result = await run(approved);
    expect(result.ok).toBe(false);
    expect(git(remote, 'rev-parse', BRANCH)).toBe(git(other, 'rev-parse', 'HEAD'));
    // Not left at the unpushed rebase, which the next attempt would refuse.
    expect(git(work, 'rev-parse', 'HEAD')).toBe(approved);
    expect(git(work, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(1);
  });

  it('without an approved head, keeps rebasing whatever the worktree holds (manual merges)', async () => {
    commit(work, 'local.txt', 'local commit');
    const result = await run();
    expect(result.ok).toBe(true);
  });
});
