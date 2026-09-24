/**
 * PAN-3881: `pan doctor` warns when the checkout `pan sync` distributes from is
 * behind its upstream, on a non-default branch, or detached. Doctor never
 * fetches: it compares with the last-fetched upstream ref and says so.
 */
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkSyncSourceCheckout } from '../../../src/cli/commands/doctor-sync-source-freshness.js';

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

describe('checkSyncSourceCheckout (PAN-3881)', () => {
  let base: string;
  let checkout: string;
  let other: string;
  let sources: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'overdeck-doctor-sync-freshness-'));
    const origin = join(base, 'origin.git');
    checkout = join(base, 'checkout');
    other = join(base, 'other');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['clone', '-q', origin, other]);
    git(other, 'checkout', '-q', '-b', 'main');
    commitFile(other, 'rule.md', 'one');
    git(other, 'push', '-q', 'origin', 'main');
    execFileSync('git', ['clone', '-q', origin, checkout]);
    sources = join(checkout, 'sync-sources');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('is OK for a current checkout on main and says it compared the last-fetched ref', async () => {
    const result = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: false });
    expect(result.status).toBe('ok');
    expect(result.message).toContain('last-fetched origin/main');
    expect(result.message).toContain('doctor does not fetch');
  });

  it('does not fetch: a new upstream commit shows only after the checkout itself fetches', async () => {
    commitFile(other, 'deleted-agent.md', 'two');
    git(other, 'push', '-q', 'origin', 'main');

    const beforeFetch = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: false });
    expect(beforeFetch.status).toBe('ok');

    git(checkout, 'fetch', '-q', 'origin');
    const afterFetch = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: false });
    expect(afterFetch.status).toBe('warn');
    expect(afterFetch.message).toContain('1 commit behind origin/main');
    expect(afterFetch.message).toContain('doctor does not fetch');
    expect(afterFetch.fix).toContain('pull --ff-only');
  });

  it('warns when the checkout is on a non-default branch', async () => {
    git(checkout, 'checkout', '-q', '-b', 'feature/x');
    const result = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: false });
    expect(result.status).toBe('warn');
    expect(result.message).toContain("on branch 'feature/x'");
  });

  it('warns when the checkout has a detached HEAD', async () => {
    git(checkout, 'checkout', '-q', '--detach');
    const result = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: false });
    expect(result.status).toBe('warn');
    expect(result.message).toContain('detached HEAD');
  });

  it('passes skipFetch to the freshness check', async () => {
    const check = vi.fn().mockResolvedValue(null);
    const result = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: false, check });
    expect(check).toHaveBeenCalledWith(sources, { skipFetch: true });
    expect(result.status).toBe('ok');
    expect(result.message).toContain('not in a git checkout');
  });

  it('skips the check for a frozen generation copy', async () => {
    const check = vi.fn();
    const result = await checkSyncSourceCheckout({ sourcesRoot: sources, frozenGeneration: true, check });
    expect(check).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
  });
});
