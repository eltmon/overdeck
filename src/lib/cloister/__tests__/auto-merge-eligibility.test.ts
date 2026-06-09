import { describe, expect, it, vi } from 'vitest';
import type { GitHubPullRequestState } from '../../github-app.js';
import type { ReviewStatus } from '../../review-status.js';
import { BLOCKER_LABELS, isAutoMergeEligible } from '../auto-merge-eligibility.js';

function makeReviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1486',
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'pending',
    updatedAt: '2026-05-25T09:00:00.000Z',
    readyForMerge: true,
    prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
    ...overrides,
  };
}

function makePrState(overrides: Partial<GitHubPullRequestState> = {}): GitHubPullRequestState {
  return {
    owner: 'eltmon',
    repo: 'panopticon-cli',
    number: 1486,
    url: 'https://github.com/eltmon/panopticon-cli/pull/1486',
    state: 'OPEN',
    merged: false,
    mergeable: true,
    mergeableState: 'clean',
    draft: false,
    headSha: 'abc1234',
    baseBranch: 'main',
    checksPending: false,
    checksFailed: false,
    ...overrides,
  };
}

describe('auto-merge eligibility', () => {
  it('exports blocker labels as a readonly tuple', () => {
    expect(BLOCKER_LABELS).toEqual(['needs-design', 'needs-discussion', 'do-not-merge']);
  });

  it('rejects issues whose review status is not readyForMerge', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({ readyForMerge: false }));
    const getPullRequestState = vi.fn(async () => makePrState());
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: false, reason: 'review status is not readyForMerge' });
    expect(getPullRequestState).not.toHaveBeenCalled();
    expect(getIssueLabels).not.toHaveBeenCalled();
  });

  it('rejects issues explicitly held for UAT (autoMerge === false)', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({ autoMerge: false }));
    const getPullRequestState = vi.fn(async () => makePrState());
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: false, reason: 'held for UAT (auto-merge toggled off)' });
    expect(getPullRequestState).not.toHaveBeenCalled();
  });

  it('does not gate issues whose autoMerge is undefined (default) or true', async () => {
    const getPullRequestState = vi.fn(async () => makePrState());
    const getIssueLabels = vi.fn(async () => []);
    for (const autoMerge of [undefined, true] as const) {
      const getReviewStatus = vi.fn(() => makeReviewStatus({ autoMerge }));
      await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
        .resolves.toEqual({ eligible: true });
    }
  });

  it('rejects PRs whose CI checks are failing', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getPullRequestState = vi.fn(async () => makePrState({ checksFailed: true, headSha: 'deadbeef' }));
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: false, reason: 'CI checks failing on PR HEAD deadbeef' });
    expect(getPullRequestState).toHaveBeenCalledWith('eltmon', 'panopticon-cli', 1486);
    expect(getIssueLabels).not.toHaveBeenCalled();
  });

  it('rejects PRs that are already merged', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getPullRequestState = vi.fn(async () => makePrState({ merged: true }));
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: false, reason: 'PR is already merged' });
    expect(getIssueLabels).not.toHaveBeenCalled();
  });

  it('rejects issues carrying blocker labels', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getPullRequestState = vi.fn(async () => makePrState());
    const getIssueLabels = vi.fn(async () => ['enhancement', 'do-not-merge']);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: false, reason: 'issue carries blocker label: do-not-merge' });
    expect(getIssueLabels).toHaveBeenCalledWith('PAN-1486');
  });

  it('returns eligible only when review, PR state, and labels all pass', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getPullRequestState = vi.fn(async () => makePrState());
    const getIssueLabels = vi.fn(async () => ['enhancement']);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: true });
  });
});
