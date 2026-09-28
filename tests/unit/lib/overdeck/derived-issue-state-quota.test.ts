/**
 * PAN-4264 Work Item 9: the repo PR cache read goes through the quota meter.
 * During a user-pool GraphQL pause it reads as "failed" (null) without
 * spawning gh, never as "no PRs".
 *
 * PAN-4291: the read also skips the forge call entirely — returning `[]`,
 * never touching gh — for a repo with no git remote or a project with no
 * resolvable tracker.
 */
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({ calls: [] as string[][], stdout: '[]' }));
const git = vi.hoisted(() => ({ remoteStdout: 'origin\n', remoteShouldReject: false }));
const trackerless = vi.hoisted(() => ({ path: '' }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd === 'git' && args[0] === 'remote') {
        if (git.remoteShouldReject) return Promise.reject(new Error('git: connection reset'));
        return Promise.resolve({ stdout: git.remoteStdout, stderr: '' });
      }
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      gh.calls.push(args);
      return Promise.resolve({ stdout: gh.stdout, stderr: '' });
    };
  return { ...actual, execFile: execFileStub };
});

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/projects.js')>();
  return {
    ...actual,
    findProjectByPath: (path: string) => {
      if (path === trackerless.path) return { name: 'no-tracker-project', path };
      return actual.findProjectByPath(path);
    },
  };
});

import { PR_CACHE_TTL_MS, readRepoPullRequests } from '../../../../src/lib/overdeck/derived-issue-state.js';
import { flushLedgerWrites, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import { recordGitHubRefusal } from '../../../../src/lib/github-quota/pause-gate.js';

// Module-level caches outlive a test, so each test uses its own repo path.
let repoSeq = 0;

describe('readRepoPullRequests quota metering (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    home = mkdtempSync(join(tmpdir(), 'pan-pr-cache-quota-'));
    process.env.OVERDECK_HOME = home;
    gh.calls.length = 0;
    git.remoteStdout = 'origin\n';
    git.remoteShouldReject = false;
    trackerless.path = '';
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('returns null and never execs gh during a user GraphQL pause', async () => {
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' } });

    await expect(readRepoPullRequests(`/repos/quota-${++repoSeq}`)).resolves.toBeNull();
    expect(gh.calls).toEqual([]);
  });

  it('meters a successful listing as caller pr-cache for a repo with an origin remote (PAN-4291 AC3)', async () => {
    gh.stdout = JSON.stringify([{ number: 1, state: 'OPEN', headRefName: 'feature/pan-1' }]);

    const rows = await readRepoPullRequests(`/repos/quota-${++repoSeq}`);
    expect(rows).toHaveLength(1);
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]!.slice(0, 2)).toEqual(['pr', 'list']);

    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now())).toEqual([expect.objectContaining({
      caller: 'pr-cache', pool: 'user', bucket: 'graphql', outcome: 'ok',
    })]);
  });

  it('lists 100 PRs and records the per-page price (PAN-4291)', async () => {
    gh.stdout = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ number: i, state: 'OPEN' })));

    await readRepoPullRequests(`/repos/quota-${++repoSeq}`);
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toContain('100');
    expect(gh.calls[0]).not.toContain('200');

    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now())).toEqual([expect.objectContaining({ caller: 'pr-cache', cost: 3 })]);
  });

  it('returns [] and execs gh zero times for a repo with no git remote (PAN-4291 AC1)', async () => {
    git.remoteStdout = '';

    const path = `/repos/quota-${++repoSeq}`;
    const rows = await readRepoPullRequests(path);
    expect(rows).toEqual([]);
    expect(gh.calls).toEqual([]);

    await flushLedgerWrites();
    expect(readLedgerWindow(Date.now())).toEqual([]);
  });

  it('returns [] and execs gh zero times for a project with no resolvable tracker (PAN-4291 AC2)', async () => {
    const path = `/repos/quota-${++repoSeq}`;
    trackerless.path = path;

    const rows = await readRepoPullRequests(path);
    expect(rows).toEqual([]);
    expect(gh.calls).toEqual([]);
  });

  it('reads a transient "git remote" failure as failed (null), never as a cached "no remote" (review NB-1)', async () => {
    git.remoteShouldReject = true;
    const path = `/repos/quota-${++repoSeq}`;

    await expect(readRepoPullRequests(path)).resolves.toBeNull();
    expect(gh.calls).toEqual([]);

    // A failed read is cached for the normal active TTL like any other
    // failure (a pause, a rate limit) — the `git remote` failure itself is
    // never cached as a confirmed "no remote", which would otherwise hide a
    // real listing for PR_CACHE_REMOTE_CHECK_TTL_MS (10 minutes) plus the
    // idle TTL (5 minutes) instead of just the normal 30 seconds.
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    git.remoteShouldReject = false;
    gh.stdout = JSON.stringify([{ number: 1, state: 'OPEN', headRefName: 'feature/pan-1' }]);
    const rows = await readRepoPullRequests(path);
    expect(rows).toHaveLength(1);
    expect(gh.calls).toHaveLength(1);
  });

  it('caches a listing with no open PR for 5 minutes instead of the flat 30 s (PAN-4291 idle-ttl AC1)', async () => {
    gh.stdout = JSON.stringify([{ number: 1, state: 'MERGED' }]);
    const path = `/repos/quota-${++repoSeq}`;

    await readRepoPullRequests(path);
    expect(gh.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await readRepoPullRequests(path);
    expect(gh.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await readRepoPullRequests(path);
    expect(gh.calls).toHaveLength(2);
  });

  it('keeps the flat 30 s TTL for a listing with an open PR (PAN-4291 idle-ttl AC2)', async () => {
    gh.stdout = JSON.stringify([{ number: 1, state: 'OPEN' }]);
    const path = `/repos/quota-${++repoSeq}`;

    await readRepoPullRequests(path);
    expect(gh.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(31_000);
    await readRepoPullRequests(path);
    expect(gh.calls).toHaveLength(2);
  });
});
