import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/lib/overdeck/pull-requests.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../src/lib/overdeck/pull-requests.js')>()),
  fetchIssuePullRequest: mockFetch,
}));

import { checkMergedRow, checkReviewRow, readMergedRowPullRequest, readPullRequestMergedAt } from '../../../../src/lib/lifecycle/dod-gate.js';
import { PR_READ_PAUSE_MS } from '../../../../src/lib/lifecycle/dod-pr-read.js';
import { stepOk } from '../../../../src/lib/lifecycle/types.js';
import type { IssuePullRequestData } from '../../../../src/lib/overdeck/pull-requests.js';

const issueId = 'PAN-4821';
const ctxWithGithub = {
  issueId,
  projectPath: '/tmp/overdeck',
  github: { owner: 'eltmon', repo: 'overdeck', number: 4821 },
};

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

  it('readMergedRowPullRequest retries once and returns the merged PR', async () => {
    mockFetch
      .mockResolvedValueOnce({ issueId, pr: null, error: 'gh pr view failed: timeout' })
      .mockResolvedValueOnce({ issueId, pr: { number: 7, state: 'MERGED', mergedAt: '2026-11-02T12:00:00Z' } });

    const pending = readMergedRowPullRequest(ctxWithGithub, `feature/${issueId.toLowerCase()}`);
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toMatchObject({ number: 7, state: 'MERGED', mergedAt: '2026-11-02T12:00:00Z' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('readMergedRowPullRequest returns {} without reading when the context has no GitHub coordinates', async () => {
    await expect(
      readMergedRowPullRequest({ issueId, projectPath: '/tmp/overdeck' }, `feature/${issueId.toLowerCase()}`),
    ).resolves.toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('row 4 records the attempt count when every read fails', async () => {
    mockFetch.mockResolvedValue({ issueId, pr: null, error: 'gh pr view failed: timeout' });

    const pending = checkMergedRow(ctxWithGithub, {
      verifyMerged: async () => stepOk('close-out:verify-merged'),
      readPullRequest: readMergedRowPullRequest,
      readBranchContainment: async () => ({ unmergedRefs: [], mergedWorkRefs: [], pointerRefs: [] }),
    });
    await vi.advanceTimersByTimeAsync(PR_READ_PAUSE_MS);

    await expect(pending).resolves.toMatchObject({
      observed: expect.stringContaining('forge metadata unavailable: pull request read failed on the forge after 2 attempts:'),
    });
  });
});
