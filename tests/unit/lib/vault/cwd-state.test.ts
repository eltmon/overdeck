import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareCwdState,
  countPorcelainStatus,
  readCwdState,
  type CwdState,
} from '../../../../src/lib/vault/cwd-state.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
}

describe('vault cwd-state', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-cwd-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('ac1: reports counts for a repo with one staged and one untracked file, without any path', async () => {
    const repo = join(root, 'repo');
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'remote', 'add', 'origin', 'https://example.com/org/repo.git');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    git(repo, 'add', 'base.txt');
    git(repo, 'commit', '-q', '-m', 'base');
    writeFileSync(join(repo, 'staged-secret-name.txt'), 'staged\n');
    git(repo, 'add', 'staged-secret-name.txt');
    writeFileSync(join(repo, 'untracked-secret-name.txt'), 'untracked\n');

    const state = await readCwdState(repo);
    expect(state).not.toBeNull();
    expect(state).toMatchObject({
      gitOrigin: 'https://example.com/org/repo.git',
      branch: 'main',
      dirty: true,
      staged: 1,
      unstaged: 0,
      untracked: 1,
      conflicted: 0,
    });
    expect(state!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(state!.head).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('secret-name');
    expect(serialized).not.toContain('.txt');
    expect(serialized).not.toContain(repo);
  });

  it('a clean repo without origin reports dirty false and null origin', async () => {
    const repo = join(root, 'clean');
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'a');
    const state = await readCwdState(repo);
    expect(state).toMatchObject({ gitOrigin: null, branch: 'main', dirty: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  });

  it('ac2: a non-git directory yields null', async () => {
    const plain = join(root, 'plain');
    execFileSync('mkdir', [plain]);
    expect(await readCwdState(plain)).toBeNull();
    expect(await readCwdState(join(root, 'does-not-exist'))).toBeNull();
  });

  it('ac3: compareCwdState names only the differing fields', () => {
    const saved: CwdState = {
      gitOrigin: 'o', head: 'aaa', branch: 'main', dirty: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
    };
    expect(compareCwdState(saved, { ...saved, head: 'bbb' })).toEqual(['head']);
    expect(compareCwdState(saved, saved)).toEqual([]);
    expect(compareCwdState(saved, { ...saved, branch: 'dev', dirty: true, untracked: 2 })).toEqual(['branch', 'dirty', 'untracked']);
  });

  it('countPorcelainStatus classifies staged, unstaged, untracked and conflicted lines', () => {
    const porcelain = [
      'M  staged.txt',
      ' M unstaged.txt',
      'MM both.txt',
      '?? new.txt',
      'UU conflict.txt',
      'AA both-added.txt',
      '!! ignored.txt',
      '',
    ].join('\n');
    expect(countPorcelainStatus(porcelain)).toEqual({ staged: 2, unstaged: 2, untracked: 1, conflicted: 2 });
  });
});
