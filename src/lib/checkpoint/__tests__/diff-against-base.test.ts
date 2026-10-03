import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffAgainstBase, diffAgainstBaseFiles, resolveBaseRef } from '../checkpoint-manager.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
    },
  });
}

describe('diffAgainstBase / diffAgainstBaseFiles / resolveBaseRef (PAN-4501)', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pan-4501-diff-against-base-'));
    git(repo, ['init', '--quiet']);
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    git(repo, ['add', 'a.txt']);
    git(repo, ['commit', '--quiet', '-m', 'initial']);
    git(repo, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(repo, 'a.txt'), 'a\nchanged\n');
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    git(repo, ['add', 'a.txt', 'b.txt']);
    git(repo, ['commit', '--quiet', '-m', 'feature change']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('resolves a local branch ref but not a branch that does not exist', async () => {
    expect(await resolveBaseRef(repo, 'trunk')).toBe('trunk');
    expect(await resolveBaseRef(repo, 'main')).toBeNull();
  });

  it('reports exactly the changed and added files against the base branch, sorted by path', async () => {
    const files = await diffAgainstBaseFiles(repo, 'trunk');
    expect(files).toEqual([
      { path: 'a.txt', kind: 'M', additions: 1, deletions: 0 },
      { path: 'b.txt', kind: 'A', additions: 1, deletions: 0 },
    ]);
  });

  it('scopes the patch to the requested file', async () => {
    const patch = await diffAgainstBase(repo, 'trunk', 'b.txt');
    expect(patch).toContain('+++ b/b.txt');
    expect(patch).not.toContain('a.txt');
  });

  it('returns no file changes when HEAD is the base branch itself', async () => {
    git(repo, ['checkout', '--quiet', 'trunk']);
    expect(await diffAgainstBaseFiles(repo, 'trunk')).toEqual([]);
  });

  it('ignores uncommitted edits on the feature branch', async () => {
    writeFileSync(join(repo, 'a.txt'), 'a\nchanged\nuncommitted\n');
    const files = await diffAgainstBaseFiles(repo, 'trunk');
    expect(files).toEqual([
      { path: 'a.txt', kind: 'M', additions: 1, deletions: 0 },
      { path: 'b.txt', kind: 'A', additions: 1, deletions: 0 },
    ]);
  });
});
