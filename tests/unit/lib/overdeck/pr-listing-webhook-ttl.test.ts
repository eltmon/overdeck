/**
 * PAN-5224: the PR listing caches' settled TTLs follow the webhook-health
 * policy (`pr-freshness.js`) instead of a flat 30 s, and a webhook can drop
 * a settled or in-flight entry via `invalidateRepoPullRequests`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runGh: vi.fn() }));

vi.mock('../../../../src/lib/github-quota/run-gh.js', () => ({
  runGh: mocks.runGh,
}));

vi.mock('../../../../src/lib/overdeck/pr-cache-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/overdeck/pr-cache-policy.js')>();
  return { ...actual, shouldListPullRequests: async () => true };
});

import {
  invalidateRepoPullRequests,
  PR_CACHE_TTL_MS,
  readOpenRepoPullRequests,
  readRepoPullRequests,
} from '../../../../src/lib/overdeck/pr-listing.js';
import { setWebhookHealthProvider } from '../../../../src/lib/overdeck/pr-freshness.js';

function openRow(number: number, mergeable = 'MERGEABLE', headRefName = 'feature/pan-7') {
  return { number, state: 'OPEN', mergeable, headRefName };
}

describe('PR listing webhook-health TTLs (PAN-5224)', () => {
  let repoSeq = 0;
  let repo = '';

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.runGh.mockReset();
    repo = `/repos/pr-listing-webhook-ttl-${++repoSeq}`;
    setWebhookHealthProvider(() => false);
  });

  afterEach(() => {
    vi.useRealTimers();
    setWebhookHealthProvider(() => false);
  });

  it('healthy provider with an OPEN row: cached 5 min, re-reads just past it (ac1)', async () => {
    setWebhookHealthProvider(() => true);
    mocks.runGh.mockResolvedValue({ stdout: JSON.stringify([openRow(1)]) });

    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000);
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });

  it('unhealthy (default) provider: the same listing re-reads after 31s (ac2)', async () => {
    mocks.runGh.mockResolvedValue({ stdout: JSON.stringify([openRow(1)]) });

    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);

    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });

  it('healthy provider, OPEN row with mergeable UNKNOWN on an issue branch: re-reads after 31s (ac3)', async () => {
    setWebhookHealthProvider(() => true);
    mocks.runGh.mockResolvedValue({ stdout: JSON.stringify([openRow(1, 'UNKNOWN', 'feature/pan-7')]) });

    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1, 'UNKNOWN', 'feature/pan-7')]);
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1, 'UNKNOWN', 'feature/pan-7')]);

    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });

  it('healthy provider, OPEN row with mergeable UNKNOWN on a non-issue branch: no re-read at 31s, re-reads just past 5 min (PAN-5261)', async () => {
    setWebhookHealthProvider(() => true);
    mocks.runGh.mockResolvedValue({ stdout: JSON.stringify([openRow(1, 'UNKNOWN', 'contrib/night-cycle')]) });

    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1, 'UNKNOWN', 'contrib/night-cycle')]);
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000); // past the 30 s UNKNOWN pin; not on an issue branch
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1, 'UNKNOWN', 'contrib/night-cycle')]);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60_000 + 28_000); // just under 5 min total
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1, 'UNKNOWN', 'contrib/night-cycle')]);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000); // just past 5 min total
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1, 'UNKNOWN', 'contrib/night-cycle')]);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });

  it('healthy provider, no OPEN row: open and closed reads are both cached 15 min', async () => {
    setWebhookHealthProvider(() => true);
    mocks.runGh.mockImplementation((args: string[]) => {
      const stateIndex = args.indexOf('--state');
      if (args[stateIndex + 1] === 'open') return Promise.resolve({ stdout: '[]' });
      return Promise.resolve({ stdout: JSON.stringify([{ number: 1, state: 'MERGED' }]) });
    });

    await expect(readRepoPullRequests(repo)).resolves.toEqual([{ number: 1, state: 'MERGED' }]);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await expect(readRepoPullRequests(repo)).resolves.toEqual([{ number: 1, state: 'MERGED' }]);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);
    await expect(readRepoPullRequests(repo)).resolves.toEqual([{ number: 1, state: 'MERGED' }]);
    expect(mocks.runGh).toHaveBeenCalledTimes(4);
  });

  it('settled healthy listing: invalidateRepoPullRequests re-reads inside the 5-minute TTL (ac4)', async () => {
    setWebhookHealthProvider(() => true);
    mocks.runGh.mockResolvedValue({ stdout: JSON.stringify([openRow(1)]) });

    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);

    invalidateRepoPullRequests(repo);
    await vi.advanceTimersByTimeAsync(1_000); // well inside the 5-minute TTL
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([openRow(1)]);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });

  it('a read in flight, then invalidateRepoPullRequests, then a second read: runGh is called twice (ac4)', async () => {
    setWebhookHealthProvider(() => true);
    let resolveFirst!: (value: { stdout: string }) => void;
    mocks.runGh
      .mockImplementationOnce(() => new Promise((done) => { resolveFirst = done; }))
      .mockResolvedValueOnce({ stdout: JSON.stringify([openRow(1)]) });

    const first = readOpenRepoPullRequests(repo);
    // Let the async shouldListPullRequests() gate resolve so the first read's
    // runGh call actually fires (and `resolveFirst` is assigned) before the
    // invalidation below races it.
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);

    invalidateRepoPullRequests(repo);
    const second = readOpenRepoPullRequests(repo);

    resolveFirst({ stdout: JSON.stringify([openRow(2)]) });
    await expect(first).resolves.toEqual([openRow(2)]);
    await expect(second).resolves.toEqual([openRow(1)]);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });
});
