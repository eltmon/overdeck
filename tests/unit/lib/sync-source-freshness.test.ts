import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkSyncSourceFreshness } from '../../../src/lib/sync-source-freshness.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    },
  }).trim();
}

function commitFile(repo: string, name: string, content: string): void {
  mkdirSync(join(repo, 'sync-sources'), { recursive: true });
  writeFileSync(join(repo, 'sync-sources', name), content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', `add ${name}`);
}

describe('checkSyncSourceFreshness (PAN-3881)', () => {
  let base: string;
  let origin: string;
  let checkout: string;
  let other: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'overdeck-sync-freshness-'));
    origin = join(base, 'origin.git');
    checkout = join(base, 'checkout');
    other = join(base, 'other');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, other]);
    git(other, 'checkout', '-q', '-b', 'main');
    commitFile(other, 'rule.md', 'one');
    git(other, 'push', '-q', 'origin', 'main');
    execFileSync('git', ['clone', '-q', origin, checkout]);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reports no warnings for a checkout on main that matches origin/main', async () => {
    const result = await checkSyncSourceFreshness(join(checkout, 'sync-sources'));
    expect(result).not.toBeNull();
    expect(result!.branch).toBe('main');
    expect(result!.upstream).toBe('origin/main');
    expect(result!.behind).toBe(0);
    expect(result!.warnings).toEqual([]);
  });

  it('warns when the checkout is behind its upstream, fetching to see the gap, and never pulls', async () => {
    commitFile(other, 'deleted-agent.md', 'two');
    git(other, 'rm', '-q', 'sync-sources/deleted-agent.md');
    git(other, 'commit', '-q', '-m', 'delete agent');
    git(other, 'push', '-q', 'origin', 'main');
    const headBefore = git(checkout, 'rev-parse', 'HEAD');

    const result = await checkSyncSourceFreshness(join(checkout, 'sync-sources'));

    expect(result!.behind).toBe(2);
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0]).toContain('2 commits behind origin/main');
    expect(result!.warnings[0]).toContain(checkout);
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(headBefore);
  });

  it('warns when the checkout is on a non-default branch', async () => {
    git(checkout, 'checkout', '-q', '-b', 'feature/x');

    const result = await checkSyncSourceFreshness(join(checkout, 'sync-sources'));

    expect(result!.branch).toBe('feature/x');
    expect(result!.warnings.some((w) => w.includes("on branch 'feature/x', not the default branch 'main'"))).toBe(true);
  });

  it('warns on a detached HEAD', async () => {
    git(checkout, 'checkout', '-q', '--detach');

    const result = await checkSyncSourceFreshness(join(checkout, 'sync-sources'));

    expect(result!.branch).toBeNull();
    expect(result!.warnings.some((w) => w.includes('detached HEAD'))).toBe(true);
  });

  it('returns null when the sources are not in a git checkout', async () => {
    const plain = join(base, 'plain', 'sync-sources');
    mkdirSync(plain, { recursive: true });
    expect(await checkSyncSourceFreshness(plain)).toBeNull();
  });
});
