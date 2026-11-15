/**
 * `readMergedPullRequestForBranch` (PAN-5310): the per-branch merged-PR read
 * for an issue older than the closed listing's ~100-row window reaches. A
 * settled answer — a row or null — is kept for the process lifetime; a
 * failed read is not kept, so the next call tries `gh` again.
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
  readMergedPullRequestForBranch,
  resetMergedPullRequestCacheForTests,
} from '../../../../src/lib/overdeck/pr-listing.js';

describe('readMergedPullRequestForBranch (PAN-5310)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.runGh.mockReset();
    resetMergedPullRequestCacheForTests();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('runs gh once for a branch and memoizes the row (ac3)', async () => {
    mocks.runGh.mockResolvedValue({ stdout: JSON.stringify([{ number: 9, url: 'https://github.com/o/r/pull/9' }]) });

    const first = await readMergedPullRequestForBranch('/repos/overdeck', 'feature/pan-1');
    const second = await readMergedPullRequestForBranch('/repos/overdeck', 'feature/pan-1');

    expect(mocks.runGh).toHaveBeenCalledTimes(1);
    expect(mocks.runGh).toHaveBeenCalledWith(
      ['pr', 'list', '--state', 'merged', '--head', 'feature/pan-1', '--limit', '1', '--json', expect.any(String)],
      expect.objectContaining({ caller: 'pr-cache', cwd: '/repos/overdeck' }),
    );
    expect(first).toEqual({ number: 9, url: 'https://github.com/o/r/pull/9' });
    expect(second).toBe(first);
  });

  it('memoizes an empty answer as null without a second gh call (ac3)', async () => {
    mocks.runGh.mockResolvedValue({ stdout: '[]' });

    const first = await readMergedPullRequestForBranch('/repos/overdeck', 'feature/pan-2');
    const second = await readMergedPullRequestForBranch('/repos/overdeck', 'feature/pan-2');

    expect(mocks.runGh).toHaveBeenCalledTimes(1);
    expect(first).toBeNull();
    expect(second).toBeNull();
  });

  it('resolves null on a failed read and retries gh on the next call (ac4)', async () => {
    mocks.runGh.mockRejectedValueOnce(new Error('HTTP 504'));
    mocks.runGh.mockResolvedValueOnce({ stdout: JSON.stringify([{ number: 9, url: 'https://github.com/o/r/pull/9' }]) });

    const first = await readMergedPullRequestForBranch('/repos/overdeck', 'feature/pan-3');
    expect(first).toBeNull();

    const second = await readMergedPullRequestForBranch('/repos/overdeck', 'feature/pan-3');
    expect(second).toEqual({ number: 9, url: 'https://github.com/o/r/pull/9' });
    expect(mocks.runGh).toHaveBeenCalledTimes(2);
  });
});
