import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { headDeletionEpoch } from '../start-freshness.js';

let repoDir: string;

function git(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  }).trim();
}

function commit(message: string, epochSeconds: number): void {
  const date = `@${epochSeconds} +0000`;
  git(['commit', '-m', message], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
}

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'start-freshness-'));
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@t']);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('headDeletionEpoch', () => {
  it('returns null for a path that was committed and never deleted', () => {
    writeFileSync(join(repoDir, 'kept.ts'), 'kept');
    git(['add', 'kept.ts']);
    commit('add kept.ts', 1_790_000_000);

    expect(headDeletionEpoch(repoDir)('kept.ts')).toBeNull();
  });

  it('returns null for a path that never existed', () => {
    writeFileSync(join(repoDir, 'other.ts'), 'other');
    git(['add', 'other.ts']);
    commit('add other.ts', 1_790_000_000);

    expect(headDeletionEpoch(repoDir)('never-existed.ts')).toBeNull();
  });

  it('returns the deletion commit epoch for a path deleted on HEAD', () => {
    writeFileSync(join(repoDir, 'a.ts'), 'a');
    git(['add', 'a.ts']);
    commit('add a.ts', 1_789_000_000);

    git(['rm', '-q', 'a.ts']);
    commit('delete a.ts', 1_790_000_000);

    expect(headDeletionEpoch(repoDir)('a.ts')).toBe(1_790_000_000);
  });

  it('returns the rename commit epoch for the old path when renamed away', () => {
    writeFileSync(join(repoDir, 'old.ts'), 'renamed');
    git(['add', 'old.ts']);
    commit('add old.ts', 1_789_000_000);

    git(['mv', 'old.ts', 'new.ts']);
    commit('rename old.ts to new.ts', 1_790_500_000);

    expect(headDeletionEpoch(repoDir)('old.ts')).toBe(1_790_500_000);
    expect(headDeletionEpoch(repoDir)('new.ts')).toBeNull();
  });

  it('returns null for a path that exists only on a turn-checkpoint ref, never on HEAD', () => {
    writeFileSync(join(repoDir, 'base.ts'), 'base');
    git(['add', 'base.ts']);
    commit('add base.ts', 1_789_000_000);

    const baseTree = git(['rev-parse', 'HEAD^{tree}']);
    writeFileSync(join(repoDir, 'checkpoint-only.ts'), 'draft');
    git(['add', 'checkpoint-only.ts']);
    const draftTree = git(['write-tree']);
    git(['reset', '--hard', 'HEAD']);

    const parent = git(['rev-parse', 'HEAD']);
    const sideCommit = git(['commit-tree', draftTree, '-p', parent, '-m', 'checkpoint'], {
      GIT_COMMITTER_DATE: '@1790200000 +0000',
      GIT_AUTHOR_DATE: '@1790200000 +0000',
    });
    git(['update-ref', 'refs/pan/turn/x/y', sideCommit]);

    expect(baseTree).toBeTruthy();
    expect(headDeletionEpoch(repoDir)('checkpoint-only.ts')).toBeNull();
  });

  it('returns null for a directory that is not a git repository', () => {
    const nonRepoDir = mkdtempSync(join(tmpdir(), 'start-freshness-non-repo-'));
    try {
      expect(headDeletionEpoch(nonRepoDir)('anything.ts')).toBeNull();
    } finally {
      rmSync(nonRepoDir, { recursive: true, force: true });
    }
  });
});
