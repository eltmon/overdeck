/**
 * PAN-5261: the open-PR read lists at most 30 rows unless the repo's last
 * open read returned 30 or more, in which case it reads at 100 directly. A
 * 30-row read that comes back with 30+ rows is re-run at 100 before it
 * settles, so a settled listing never holds fewer rows than a flat 100-row
 * read would.
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

import { PR_CACHE_TTL_MS, readOpenRepoPullRequests } from '../../../../src/lib/overdeck/pr-listing.js';

function openRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, state: 'OPEN', mergeable: 'MERGEABLE' }));
}

function limitArg(args: readonly string[]): string | undefined {
  const i = args.indexOf('--limit');
  return i === -1 ? undefined : args[i + 1];
}

describe('PR open-read limit (PAN-5261)', () => {
  let repoSeq = 0;
  let repo = '';

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.runGh.mockReset();
    repo = `/repos/pr-listing-open-limit-${++repoSeq}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a repo with 3 open rows reads once at --limit 30', async () => {
    mocks.runGh.mockResolvedValueOnce({ stdout: JSON.stringify(openRows(3)) });

    await expect(readOpenRepoPullRequests(repo)).resolves.toHaveLength(3);

    expect(mocks.runGh).toHaveBeenCalledTimes(1);
    expect(limitArg(mocks.runGh.mock.calls[0]![0] as string[])).toBe('30');
  });

  it('a read at 30 returning 30 rows re-reads at 100 and returns the 100-call rows', async () => {
    mocks.runGh
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(30)) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(45)) });

    const rows = await readOpenRepoPullRequests(repo);

    expect(rows).toHaveLength(45);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
    expect(limitArg(mocks.runGh.mock.calls[0]![0] as string[])).toBe('30');
    expect(limitArg(mocks.runGh.mock.calls[1]![0] as string[])).toBe('100');
  });

  it("that repo's next load after the TTL starts at --limit 100 with one call", async () => {
    mocks.runGh
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(30)) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(45)) });
    await readOpenRepoPullRequests(repo);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);

    mocks.runGh.mockReset();
    mocks.runGh.mockResolvedValueOnce({ stdout: JSON.stringify(openRows(40)) });
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);

    const rows = await readOpenRepoPullRequests(repo);

    expect(rows).toHaveLength(40);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);
    expect(limitArg(mocks.runGh.mock.calls[0]![0] as string[])).toBe('100');
  });

  it('a full-read repo whose read at 100 returns 5 rows goes back to --limit 30 next load', async () => {
    // Establish the full-read state (30 -> re-read at 100).
    mocks.runGh
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(30)) })
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(50)) });
    await readOpenRepoPullRequests(repo);
    expect(mocks.runGh).toHaveBeenCalledTimes(2);

    // Next load: reads at 100 directly, returns fewer than 30 rows.
    mocks.runGh.mockReset();
    mocks.runGh.mockResolvedValueOnce({ stdout: JSON.stringify(openRows(5)) });
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    const shrunk = await readOpenRepoPullRequests(repo);
    expect(shrunk).toHaveLength(5);
    expect(limitArg(mocks.runGh.mock.calls[0]![0] as string[])).toBe('100');

    // The load after that goes back to --limit 30.
    mocks.runGh.mockReset();
    mocks.runGh.mockResolvedValueOnce({ stdout: JSON.stringify(openRows(5)) });
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    await readOpenRepoPullRequests(repo);
    expect(mocks.runGh).toHaveBeenCalledTimes(1);
    expect(limitArg(mocks.runGh.mock.calls[0]![0] as string[])).toBe('30');
  });

  it('a rejected re-read at 100 settles null, never the 30-row listing', async () => {
    mocks.runGh
      .mockResolvedValueOnce({ stdout: JSON.stringify(openRows(30)) })
      .mockRejectedValueOnce(new Error('rate limited'));

    await expect(readOpenRepoPullRequests(repo)).resolves.toBeNull();
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });
});
