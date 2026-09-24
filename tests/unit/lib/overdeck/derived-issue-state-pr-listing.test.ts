/**
 * The PR listing's stale-while-revalidate read (PAN-3925).
 *
 * `gh pr list --state all --limit 200` with `statusCheckRollup` takes ~11s on
 * a busy repo. `listRepoPullRequests` caches it for `PR_CACHE_TTL_MS` and then
 * makes the next read wait for the forge again. Board reads go through
 * `listRepoPullRequestsStaleOk`, which answers from the last good listing
 * while one refresh runs, until that listing is older than
 * `PR_LISTING_MAX_STALE_MS`.
 */
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({
  calls: 0,
  /** Each spawn takes the next pending answer; the test resolves it. */
  pending: [] as Array<{ resolve: (stdout: string) => void; reject: (error: Error) => void }>,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string): Promise<{ stdout: string; stderr: string }> => {
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      gh.calls += 1;
      return new Promise((resolve, reject) => {
        gh.pending.push({ resolve: (stdout) => resolve({ stdout, stderr: '' }), reject });
      });
    };
  return { ...actual, execFile: execFileStub };
});

import {
  PR_CACHE_TTL_MS,
  PR_LISTING_MAX_STALE_MS,
  listRepoPullRequests,
  listRepoPullRequestsStaleOk,
} from '../../../../src/lib/overdeck/derived-issue-state.js';

const listing = (...branches: string[]) =>
  JSON.stringify(branches.map((headRefName, index) => ({ number: index + 1, state: 'OPEN', headRefName })));

/** Answer the oldest pending `gh` spawn and let its promise chain settle. */
async function answerGh(stdout: string): Promise<void> {
  const next = gh.pending.shift();
  if (!next) throw new Error('no gh spawn is pending');
  next.resolve(stdout);
  await vi.advanceTimersByTimeAsync(0);
}

async function failGh(): Promise<void> {
  const next = gh.pending.shift();
  if (!next) throw new Error('no gh spawn is pending');
  next.reject(new Error('gh: HTTP 502'));
  await vi.advanceTimersByTimeAsync(0);
}

const branchesOf = (rows: ReadonlyArray<{ headRefName?: string }>) => rows.map((row) => row.headRefName);

// Module-level caches outlive a test, so each test uses its own repo path.
let repoSeq = 0;
let repo = '';

describe('listRepoPullRequestsStaleOk (PAN-3925)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    gh.calls = 0;
    gh.pending.length = 0;
    repo = `/repos/swr-${++repoSeq}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the forge on the first read, then serves the cached listing inside the TTL', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    expect(gh.calls).toBe(1);
    await answerGh(listing('feature/pan-1'));
    expect(branchesOf(await first)).toEqual(['feature/pan-1']);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    expect(gh.calls).toBe(1);
  });

  it('answers past the TTL from the last listing at once while exactly one refresh runs', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    await answerGh(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    // The refresh is still pending, yet both reads answer with the old rows.
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    expect(gh.calls).toBe(2);
    expect(gh.pending).toHaveLength(1);

    await answerGh(listing('feature/pan-1', 'feature/pan-2'));
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1', 'feature/pan-2']);
    expect(gh.calls).toBe(2);
  });

  it('waits for the forge once the last listing is older than the stale bound', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    await answerGh(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_LISTING_MAX_STALE_MS + 1_000);
    let settled = false;
    const read = listRepoPullRequestsStaleOk(repo).then((rows) => { settled = true; return rows; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await answerGh(listing('feature/pan-9'));
    expect(branchesOf(await read)).toEqual(['feature/pan-9']);
  });

  it('keeps serving the last good listing when a refresh fails', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    await answerGh(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    await failGh();

    // The strict read reports the failed refresh as an empty listing; the
    // board read still has the last good one.
    expect(await listRepoPullRequests(repo)).toEqual([]);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
  });

  it('leaves listRepoPullRequests strict: past the TTL it waits for the forge', async () => {
    const first = listRepoPullRequests(repo);
    await answerGh(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    let settled = false;
    const read = listRepoPullRequests(repo).then((rows) => { settled = true; return rows; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await answerGh(listing('feature/pan-2'));
    expect(branchesOf(await read)).toEqual(['feature/pan-2']);
  });
});
