/**
 * PAN-4223 WI-3 step 3: lane worktree helpers against a real temporary git repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addBranchWorktree, addDetachedWorktree, applySparse, fetchBase, laneDirName } from '../worktree.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Lane Test',
      GIT_AUTHOR_EMAIL: 'lane@test.invalid',
      GIT_COMMITTER_NAME: 'Lane Test',
      GIT_COMMITTER_EMAIL: 'lane@test.invalid',
    },
  }).trim();
}

let root: string;
let repo: string;
let firstCommit: string;
let secondCommit: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lane-worktree-'));
  repo = join(root, 'project');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  mkdirSync(join(repo, 'assets'));
  writeFileSync(join(repo, 'assets', 'big.bin'), 'x\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'first');
  firstCommit = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  git(repo, 'commit', '-q', '-am', 'second');
  secondCommit = git(repo, 'rev-parse', 'HEAD');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('laneDirName', () => {
  it('accepts a lowercase lane directory name', () => {
    expect(laneDirName('hotel-663-i2')).toBe('hotel-663-i2');
  });

  it('rejects names with slashes or uppercase', () => {
    expect(() => laneDirName('Bad/Name')).toThrow(/Bad\/Name/);
    expect(() => laneDirName('-leading')).toThrow();
  });
});

describe('fetchBase', () => {
  it('returns a warning instead of throwing when origin is missing', async () => {
    const warning = await fetchBase(repo);
    expect(warning).toMatch(/git fetch origin failed/);
  });
});

describe('addBranchWorktree', () => {
  it('cuts a new branch from the base, then reuses an existing branch without -b', async () => {
    const first = join(root, 'lanes', 'hotel-663');
    await addBranchWorktree(repo, first, 'hotel/663', firstCommit);
    expect(git(first, 'branch', '--show-current')).toBe('hotel/663');
    expect(git(first, 'rev-parse', 'HEAD')).toBe(firstCommit);

    // Free the branch, then add it again: the branch exists, so no -b and the base is ignored.
    git(repo, 'worktree', 'remove', first);
    const again = join(root, 'lanes', 'hotel-663-again');
    await addBranchWorktree(repo, again, 'hotel/663', secondCommit);
    expect(git(again, 'branch', '--show-current')).toBe('hotel/663');
    expect(git(again, 'rev-parse', 'HEAD')).toBe(firstCommit);
  });
});

describe('addDetachedWorktree', () => {
  it('creates a worktree with HEAD detached at the requested commit', async () => {
    const path = join(root, 'lanes', 'hotel-663-c1');
    await addDetachedWorktree(repo, path, firstCommit);
    expect(git(path, 'rev-parse', 'HEAD')).toBe(firstCommit);
    expect(git(path, 'branch', '--show-current')).toBe('');
  });
});

describe('applySparse', () => {
  it('applies no-cone patterns to the worktree', async () => {
    const path = join(root, 'lanes', 'hotel-664');
    await addBranchWorktree(repo, path, 'hotel/664', 'main');
    await applySparse(path, ['/*', '!/assets/*']);
    expect(existsSync(join(path, 'a.txt'))).toBe(true);
    expect(existsSync(join(path, 'assets', 'big.bin'))).toBe(false);
  });
});
