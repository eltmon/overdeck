import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/overdeck/pull-requests.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../src/lib/overdeck/pull-requests.js')>()),
  fetchIssuePullRequest: mockFetch,
}));

import { checkReviewRow, readPullRequestMergedAt } from '../../../../src/lib/lifecycle/dod-gate.js';
import { PR_READ_PAUSE_MS } from '../../../../src/lib/lifecycle/dod-pr-read.js';
import type { IssuePullRequestData } from '../../../../src/lib/overdeck/pull-requests.js';

const issueId = 'PAN-4821';

const approvedPr = {
  number: 42,
  reviewDecision: 'APPROVED',
  statusCheckRollup: [{ name: 'test', conclusion: 'SUCCESS' }],
} as IssuePullRequestData;

describe('dod-gate default PR read wiring (PAN-4821)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rows 1 and 2 pass when the first read fails and the retry returns the approved PR', async () => {
    mockFetch
      .mockResolvedValueOnce({ issueId, pr: null, error: 'gh pr view failed: timeout' })
      .mockResolvedValueOnce({ issueId, pr: approvedPr });

    const pending = checkReviewRow(issueId);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toMatchObject({ status: 'pass' });
  });

  it('row 1 misses with the read error after two failed reads', async () => {
    mockFetch.mockResolvedValue({ issueId, pr: null, error: 'gh pr view failed: timeout' });

    const pending = checkReviewRow(issueId);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toMatchObject({
      status: 'miss',
      observed: 'pull request read failed on the forge after 2 attempts: gh pr view failed: timeout',
    });
  });

  it('readPullRequestMergedAt returns undefined instead of throwing after two failed reads', async () => {
    mockFetch.mockResolvedValue({ issueId, pr: null, error: 'gh pr view failed: timeout' });

    const pending = readPullRequestMergedAt(issueId);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toBeUndefined();
  });

  it('readPullRequestMergedAt returns the PR\'s mergedAt', async () => {
    mockFetch.mockResolvedValueOnce({ issueId, pr: { ...approvedPr, mergedAt: '2026-11-02T12:00:00Z' } });

    await expect(readPullRequestMergedAt(issueId)).resolves.toBe('2026-11-02T12:00:00Z');
  });
});
