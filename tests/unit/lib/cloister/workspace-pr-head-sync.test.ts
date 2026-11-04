import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  syncWorkspaceRootsToPrHead,
  syncWorkspaceToPrHead,
} from '../../../../src/lib/cloister/workspace-pr-head-sync.js';
import type { WorkspaceRepoRoot } from '../../../../src/lib/project-repos.js';

const BRANCH = 'feature/pan-1';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim();

function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', `edit ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

describe('syncWorkspaceToPrHead (PAN-4810)', () => {
  let root: string;
  let origin: string;
  /** The pipeline workspace. */
  let ws: string;
  /** Another checkout that pushes to the PR, like a handoff worktree. */
  let other: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-pr-head-sync-'));
    origin = join(root, 'origin.git');
    ws = join(root, 'ws');
    other = join(root, 'other');
    git(root, 'init', '-q', '--bare', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, ws);
    commit(ws, 'base.txt', 'base\n');
    git(ws, 'push', '-q', 'origin', 'HEAD:main');
    git(ws, 'checkout', '-q', '-b', BRANCH);
    commit(ws, 'feature.txt', 'one\n');
    git(ws, 'push', '-q', '-u', 'origin', BRANCH);
    git(root, 'clone', '-q', '-b', BRANCH, origin, other);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** The PR moves on from the other checkout. */
  const pushFromElsewhere = (content = 'two\n'): string => {
    const sha = commit(other, 'feature.txt', content);
    git(other, 'push', '-q', 'origin', BRANCH);
    return sha;
  };

  /** main moves on, and the workspace merges it in the way verification does. */
  const machineMergeOfMain = (): void => {
    git(other, 'fetch', '-q', 'origin', 'main');
    git(other, 'checkout', '-q', '-b', 'tmp-main', 'origin/main');
    commit(other, 'main.txt', 'main\n');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    git(other, 'checkout', '-q', BRANCH);
    git(ws, 'fetch', '-q', 'origin', 'main');
    git(ws, 'merge', '-q', '--no-edit', 'origin/main');
  };

  it('leaves a workspace at the PR head alone', async () => {
    await expect(syncWorkspaceToPrHead(ws, BRANCH, 'main')).resolves.toEqual({ kind: 'at-pr-head' });
  });

  it('fast-forwards a workspace behind the PR head', async () => {
    const before = git(ws, 'rev-parse', 'HEAD');
    const prHead = pushFromElsewhere();

    await expect(syncWorkspaceToPrHead(ws, BRANCH, 'main'))
      .resolves.toEqual({ kind: 'moved', mode: 'fast-forward', from: before, to: prHead });
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(prHead);
    expect(git(ws, 'branch', '--show-current')).toBe(BRANCH);
  });

  it('resets past machine merges of main to the PR head', async () => {
    machineMergeOfMain();
    const stale = git(ws, 'rev-parse', 'HEAD');
    const prHead = pushFromElsewhere();

    await expect(syncWorkspaceToPrHead(ws, BRANCH, 'main'))
      .resolves.toEqual({ kind: 'moved', mode: 'reset', from: stale, to: prHead });
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(prHead);
  });

  it('refuses when both the workspace and the PR have real commits', async () => {
    const local = commit(ws, 'local.txt', 'mine\n');
    pushFromElsewhere();

    const outcome = await syncWorkspaceToPrHead(ws, BRANCH, 'main');
    expect(outcome).toMatchObject({ kind: 'refused', reason: 'diverged' });
    expect(outcome.kind === 'refused' && outcome.detail).toContain(local.slice(0, 12));
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(local);
  });

  it('refuses to reset over uncommitted changes to tracked files', async () => {
    machineMergeOfMain();
    const stale = git(ws, 'rev-parse', 'HEAD');
    pushFromElsewhere();
    writeFileSync(join(ws, 'base.txt'), 'uncommitted\n');

    await expect(syncWorkspaceToPrHead(ws, BRANCH, 'main'))
      .resolves.toMatchObject({ kind: 'refused', reason: 'dirty-workspace' });
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(stale);
    expect(readFileSync(join(ws, 'base.txt'), 'utf-8')).toBe('uncommitted\n');
  });

  it('leaves a workspace ahead of the PR head alone', async () => {
    const local = commit(ws, 'local.txt', 'unpushed\n');

    await expect(syncWorkspaceToPrHead(ws, BRANCH, 'main')).resolves.toEqual({ kind: 'ahead' });
    expect(git(ws, 'rev-parse', 'HEAD')).toBe(local);
  });

  it('skips a branch that is not on origin yet', async () => {
    git(ws, 'checkout', '-q', '-b', 'feature/pan-2');

    await expect(syncWorkspaceToPrHead(ws, 'feature/pan-2', 'main')).resolves.toEqual({ kind: 'no-pr-branch' });
  });

  it('skips a workspace that is not on the PR branch', async () => {
    git(ws, 'checkout', '-q', '--detach');
    pushFromElsewhere();

    await expect(syncWorkspaceToPrHead(ws, BRANCH, 'main')).resolves.toEqual({ kind: 'not-on-branch', current: '' });
  });

  describe('syncWorkspaceRootsToPrHead', () => {
    const roots = (): WorkspaceRepoRoot[] => [
      { repoKey: 'ws', dir: ws, sourceBranch: BRANCH, targetBranch: 'main', isPolyrepo: false } as WorkspaceRepoRoot,
    ];

    it('journals a move and reports no failure', async () => {
      machineMergeOfMain();
      const stale = git(ws, 'rev-parse', 'HEAD');
      const prHead = pushFromElsewhere();
      const journal = vi.fn();

      await expect(syncWorkspaceRootsToPrHead('PAN-1', ws, 'test', { roots: roots(), journal })).resolves.toEqual([]);
      expect(journal).toHaveBeenCalledWith(ws, {
        type: 'workspace.synced-to-pr-head',
        issueId: 'PAN-1',
        source: 'test',
        data: { branch: BRANCH, from: stale, to: prHead, mode: 'reset' },
      });
    });

    it('journals nothing when the workspace is already at the PR head', async () => {
      const journal = vi.fn();

      await expect(syncWorkspaceRootsToPrHead('PAN-1', ws, 'test', { roots: roots(), journal })).resolves.toEqual([]);
      expect(journal).not.toHaveBeenCalled();
    });

    it('returns a failed sync result for a refused root', async () => {
      commit(ws, 'local.txt', 'mine\n');
      pushFromElsewhere();
      const journal = vi.fn();

      const failures = await syncWorkspaceRootsToPrHead('PAN-1', ws, 'test', { roots: roots(), journal });
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ repoDir: ws, targetBranch: BRANCH, success: false });
      expect(failures[0].errorOutput).toContain('(diverged)');
      expect(journal).not.toHaveBeenCalled();
    });
  });
});
