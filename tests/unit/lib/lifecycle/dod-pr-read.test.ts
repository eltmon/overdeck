import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PR_READ_PAUSE_MS,
  PullRequestReadError,
  readPullRequestWithRetry,
} from '../../../../src/lib/lifecycle/dod-pr-read.js';
import type { IssuePrEndpointResponse, IssuePullRequestData } from '../../../../src/lib/overdeck/pull-requests.js';

const issueId = 'PAN-4821';
const pr42 = { number: 42 } as IssuePullRequestData;

describe('readPullRequestWithRetry (PAN-4821)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the PR when the first read fails and the retry succeeds', async () => {
    const fetchPr = vi.fn<(issueId: string) => Promise<IssuePrEndpointResponse>>()
      .mockResolvedValueOnce({ issueId, pr: null, error: 'GitHub App PR lookup failed: 403' })
      .mockResolvedValueOnce({ issueId, pr: pr42 });

    const pending = readPullRequestWithRetry(fetchPr, issueId);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toEqual(pr42);
    expect(fetchPr).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('PAN-4821 pull request read failed (attempt 1 of 2): GitHub App PR lookup failed: 403'),
    );
  });

  it('treats a thrown fetch like an error response', async () => {
    const fetchPr = vi.fn<(issueId: string) => Promise<IssuePrEndpointResponse>>()
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ issueId, pr: pr42 });

    const pending = readPullRequestWithRetry(fetchPr, issueId);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toEqual(pr42);
  });

  it('returns null without retrying when the forge answers that no PR exists', async () => {
    const fetchPr = vi.fn<(issueId: string) => Promise<IssuePrEndpointResponse>>()
      .mockResolvedValueOnce({ issueId, pr: null });

    const result = await readPullRequestWithRetry(fetchPr, issueId);

    expect(result).toBeNull();
    expect(fetchPr).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('throws PullRequestReadError carrying the last error after two failed reads, and stops at two', async () => {
    const fetchPr = vi.fn<(issueId: string) => Promise<IssuePrEndpointResponse>>()
      .mockResolvedValue({ issueId, pr: null, error: 'gh pr view failed: timeout' });

    const pending = readPullRequestWithRetry(fetchPr, issueId);
    const settled = expect(pending).rejects.toThrow(
      'pull request read failed on the forge after 2 attempts: gh pr view failed: timeout',
    );
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);
    await settled;

    expect(fetchPr).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchPr).toHaveBeenCalledTimes(2);

    await expect(pending).rejects.toBeInstanceOf(PullRequestReadError);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('does not issue the second read before the pause elapses', async () => {
    const fetchPr = vi.fn<(issueId: string) => Promise<IssuePrEndpointResponse>>()
      .mockResolvedValueOnce({ issueId, pr: null, error: 'gh pr view failed: timeout' })
      .mockResolvedValueOnce({ issueId, pr: pr42 });

    const pending = readPullRequestWithRetry(fetchPr, issueId);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS - 1);
    expect(fetchPr).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchPr).toHaveBeenCalledTimes(2);

    await expect(pending).resolves.toEqual(pr42);
  });
});
