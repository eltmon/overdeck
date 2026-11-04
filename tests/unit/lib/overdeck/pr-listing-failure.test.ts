/**
 * `describePrListingFailure` and the once-per-change `[pr-cache]` failure/
 * recovery log (PAN-5042 FR-3). Before this, a failed PR listing's `catch {}`
 * logged nothing, so the auto-merge scheduler's "PR listing unavailable"
 * reports carried no cause.
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
  describePrListingFailure,
  PR_CACHE_TTL_MS,
  readOpenRepoPullRequests,
  readRepoPullRequests,
} from '../../../../src/lib/overdeck/pr-listing.js';
import { GitHubQuotaPausedError, GitHubRateLimitedError } from '../../../../src/lib/github-quota/pause-gate.js';

const PAUSE = {
  pool: 'user' as const,
  bucket: 'graphql' as const,
  kind: 'primary' as const,
  until: new Date(Date.now() + 60_000).toISOString(),
};

describe('describePrListingFailure (ac1)', () => {
  it('reads the first non-empty stderr line, trimmed', () => {
    const error = { stderr: '\nHTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)\n' };
    expect(describePrListingFailure(error)).toBe('HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)');
  });

  it('reports a timeout for a killed exec with no stderr', () => {
    expect(describePrListingFailure({ killed: true, signal: 'SIGTERM' })).toBe('timed out after 20s');
  });

  it('reports a quota pause', () => {
    expect(describePrListingFailure(new GitHubQuotaPausedError(PAUSE))).toMatch(/^quota pause:/);
  });

  it('reports a rate limit', () => {
    expect(describePrListingFailure(new GitHubRateLimitedError(PAUSE))).toMatch(/^rate limited:/);
  });

  it('reports a maxBuffer overrun before a timeout, even though Node sets killed too', () => {
    const error = { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true };
    expect(describePrListingFailure(error)).toBe('output exceeded maxBuffer');
  });

  it('falls back to the first line of the message, cut to 200 characters', () => {
    const long = 'x'.repeat(250);
    expect(describePrListingFailure(new Error(long))).toHaveLength(200);
  });
});

describe('[pr-cache] failure/recovery logging (ac2-ac4)', () => {
  let repoSeq = 0;
  let repo = '';
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.runGh.mockReset();
    repo = `/repos/pr-listing-failure-${++repoSeq}`;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
    log.mockRestore();
  });

  const gatewayTimeout = { stderr: '\nHTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)\n' };
  const connectionReset = { stderr: '\nHTTP 502: connection reset\n' };

  it('logs the same recurring open failure exactly once across three reads 31s apart (ac2)', async () => {
    mocks.runGh.mockRejectedValue(gatewayTimeout);

    await expect(readOpenRepoPullRequests(repo)).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    await expect(readOpenRepoPullRequests(repo)).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    await expect(readOpenRepoPullRequests(repo)).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `[pr-cache] ${repo}: open PR listing failed: HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)`,
    );
  });

  it('logs again for a different reason, then logs recovery once the read succeeds (ac3)', async () => {
    mocks.runGh.mockRejectedValueOnce(gatewayTimeout);
    await expect(readOpenRepoPullRequests(repo)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    mocks.runGh.mockRejectedValueOnce(connectionReset);
    await expect(readOpenRepoPullRequests(repo)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(`[pr-cache] ${repo}: open PR listing failed: HTTP 502: connection reset`);

    await vi.advanceTimersByTimeAsync(PR_CACHE_TTL_MS + 1_000);
    mocks.runGh.mockResolvedValueOnce({ stdout: '[]' });
    await expect(readOpenRepoPullRequests(repo)).resolves.toEqual([]);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`[pr-cache] ${repo}: open PR listing recovered`);
  });

  it('logs a closed-listing failure with the closed label (ac4)', async () => {
    mocks.runGh.mockImplementation((args: string[]) => {
      const stateIndex = args.indexOf('--state');
      if (args[stateIndex + 1] === 'open') return Promise.resolve({ stdout: '[]' });
      return Promise.reject(gatewayTimeout);
    });

    await expect(readRepoPullRequests(repo)).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('closed PR listing failed:');
  });
});
