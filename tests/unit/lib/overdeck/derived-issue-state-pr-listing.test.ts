/**
 * The PR listing's stale-while-revalidate read (PAN-3925).
 *
 * `readRepoPullRequests` is a sequential pair of `gh pr list` calls — open
 * (every field) then closed (no `statusCheckRollup`) — after a single
 * combined `--state all --limit 100` call with `statusCheckRollup` answered
 * an HTTP 504 past ~11s on a busy repo (PAN-5042). The open read caches at
 * the active TTL (or the idle TTL when it has no open PR); the closed read
 * caches at the idle TTL once it settles. `listRepoPullRequestsStaleOk`
 * answers from the last good combined listing while one refresh runs, until
 * that listing is older than `PR_LISTING_MAX_STALE_MS`.
 */
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gh = vi.hoisted(() => ({
  calls: 0,
  /** Each spawn takes the next pending answer; the test resolves it by state. */
  pending: [] as Array<{ args: string[]; resolve: (stdout: string) => void; reject: (error: Error) => void }>,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  function execFileStub(..._args: unknown[]): never {
    throw new Error('execFile without promisify is not expected in these tests');
  }
  (execFileStub as unknown as Record<PropertyKey, unknown>)[promisify.custom] =
    (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
      if (cmd !== 'gh') return Promise.reject(new Error(`unexpected execFile: ${cmd}`));
      gh.calls += 1;
      return new Promise((resolve, reject) => {
        gh.pending.push({ args, resolve: (stdout) => resolve({ stdout, stderr: '' }), reject });
      });
    };
  return { ...actual, execFile: execFileStub };
});

// PAN-4291: this file exercises the stale-while-revalidate cache, not the
// no-remote/no-tracker skip gate (covered in derived-issue-state-quota.test.ts).
vi.mock('../../../../src/lib/overdeck/pr-cache-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/overdeck/pr-cache-policy.js')>();
  return { ...actual, shouldListPullRequests: async () => true };
});

import {
  PR_CACHE_TTL_MS,
  PR_LISTING_MAX_STALE_MS,
  listRepoPullRequests,
  listRepoPullRequestsStaleOk,
} from '../../../../src/lib/overdeck/derived-issue-state.js';

const listing = (...branches: string[]) =>
  JSON.stringify(branches.map((headRefName, index) => ({ number: index + 1, state: 'OPEN', headRefName })));

const closedListing = (...numbers: number[]) =>
  JSON.stringify(numbers.map((number) => ({ number, state: 'MERGED' })));

function pendingFor(state: 'open' | 'closed') {
  return gh.pending.find((call) => {
    const i = call.args.indexOf('--state');
    return i !== -1 && call.args[i + 1] === state;
  });
}

/**
 * Answer the pending `gh` spawn for `state` and let its promise chain settle.
 * PAN-4291: the skip-gate check adds a microtask hop before the spawn, so a
 * call made right after triggering a read may need a tick to actually land
 * in `gh.pending` first.
 */
async function answerGh(state: 'open' | 'closed', stdout: string): Promise<void> {
  if (!pendingFor(state)) await vi.advanceTimersByTimeAsync(0);
  const next = pendingFor(state);
  if (!next) throw new Error(`no gh ${state} spawn is pending`);
  gh.pending.splice(gh.pending.indexOf(next), 1);
  next.resolve(stdout);
  await vi.advanceTimersByTimeAsync(0);
}

async function failGh(state: 'open' | 'closed'): Promise<void> {
  if (!pendingFor(state)) await vi.advanceTimersByTimeAsync(0);
  const next = pendingFor(state);
  if (!next) throw new Error(`no gh ${state} spawn is pending`);
  gh.pending.splice(gh.pending.indexOf(next), 1);
  next.reject(new Error('gh: HTTP 502'));
  await vi.advanceTimersByTimeAsync(0);
}

/** Answer one full combined read: the open call, then the closed call. */
async function answerRead(openStdout: string, closedStdout = '[]'): Promise<void> {
  await answerGh('open', openStdout);
  await answerGh('closed', closedStdout);
}

const branchesOf = (rows: ReadonlyArray<{ headRefName?: string }>) => rows.map((row) => row.headRefName);
const numbersOf = (rows: ReadonlyArray<{ number?: number }>) => rows.map((row) => row.number);

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
    // PAN-4291: the skip-gate check adds a microtask hop before the gh spawn.
    await vi.advanceTimersByTimeAsync(0);
    expect(gh.calls).toBe(1);
    await answerRead(listing('feature/pan-1'));
    expect(branchesOf(await first)).toEqual(['feature/pan-1']);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    expect(gh.calls).toBe(2);
  });

  it('answers past the TTL from the last listing at once while exactly one refresh runs', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    await answerRead(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    // The open read's active TTL (it has an open PR) expired; the closed
    // read's idle TTL has not, so only the open read refreshes.
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    expect(gh.calls).toBe(3);
    expect(gh.pending).toHaveLength(1);

    await answerGh('open', listing('feature/pan-1', 'feature/pan-2'));
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-2', 'feature/pan-1']);
    expect(gh.calls).toBe(3);
  });

  it('waits for the forge once the last listing is older than the stale bound', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    await answerRead(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_LISTING_MAX_STALE_MS + 1_000);
    let settled = false;
    const read = listRepoPullRequestsStaleOk(repo).then((rows) => { settled = true; return rows; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    // The closed read's 5-minute idle TTL outlives the 2-minute stale bound,
    // so only the open read goes back to the forge.
    await answerGh('open', listing('feature/pan-9'));
    expect(branchesOf(await read)).toEqual(['feature/pan-9']);
  });

  it('keeps serving the last good listing when the open refresh fails', async () => {
    const first = listRepoPullRequestsStaleOk(repo);
    await answerRead(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
    await failGh('open');

    // The strict read reports the failed refresh as null (empty listing);
    // the board read still has the last good combined one.
    expect(await listRepoPullRequests(repo)).toEqual([]);
    expect(branchesOf(await listRepoPullRequestsStaleOk(repo))).toEqual(['feature/pan-1']);
  });

  it('leaves listRepoPullRequests strict: past the TTL it waits for the forge', async () => {
    const first = listRepoPullRequests(repo);
    await answerRead(listing('feature/pan-1'));
    await first;

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    let settled = false;
    const read = listRepoPullRequests(repo).then((rows) => { settled = true; return rows; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await answerGh('open', listing('feature/pan-2'));
    expect(branchesOf(await read)).toEqual(['feature/pan-2']);
  });

  it('combines a reopened PR: the open read that settles later wins over a stale closed row (PAN-5042)', async () => {
    const openRow = (number: number) => ({ number, state: 'OPEN', headRefName: `feature/pan-${number}` });

    const first = listRepoPullRequestsStaleOk(repo);
    // First combined read: PR 1 open, PR 7 and PR 5 closed. The open read
    // has an open PR, so it caches at the active TTL, not the idle one.
    await answerRead(JSON.stringify([openRow(1)]), closedListing(7, 5));
    expect(numbersOf(await first)).toEqual([7, 5, 1]);

    // 31s later the open read's active TTL expired and it now sees PR 7
    // reopened; the closed read's 5-minute idle TTL has not, so no new
    // closed call is issued. The stale-ok read answers from the old
    // combined listing at once while that one refresh runs.
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    expect(numbersOf(await listRepoPullRequestsStaleOk(repo))).toEqual([7, 5, 1]);
    expect(pendingFor('closed')).toBeUndefined();

    await answerGh('open', JSON.stringify([openRow(8), openRow(7), openRow(1)]));
    const rows = await listRepoPullRequestsStaleOk(repo);
    expect(numbersOf(rows)).toEqual([8, 7, 5, 1]);
    const seven = rows.find((row) => row.number === 7);
    expect(seven?.state).toBe('OPEN');
  });
});
