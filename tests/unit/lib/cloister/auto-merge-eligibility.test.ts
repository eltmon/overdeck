import { describe, it, expect } from 'vitest';
import {
  classifyAutoMergeIneligibility,
  isAutoMergeEligible,
  type AutoMergeIneligibilityCode,
  type AutoMergeEligibilityDeps,
} from '../../../../src/lib/cloister/auto-merge-eligibility.js';
import type { GitHubPullRequestState } from '../../../../src/lib/github-app.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

function makeReviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1758',
    reviewStatus: 'passed',
    testStatus: 'passed',
    readyForMerge: true,
    updatedAt: new Date().toISOString(),
    prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1758',
    ...overrides,
  };
}

function makeGitHubPrState(overrides: Partial<GitHubPullRequestState> = {}): GitHubPullRequestState {
  return {
    owner: 'eltmon',
    repo: 'panopticon-cli',
    number: 1758,
    state: 'OPEN',
    merged: false,
    mergeable: true,
    mergeableState: null,
    draft: false,
    headSha: 'abc123',
    baseBranch: 'main',
    checksPending: false,
    checksFailed: false,
    ...overrides,
  };
}

describe('classifyAutoMergeIneligibility', () => {
  it.each([
    ['checks_pending', 'retryable'],
    ['not_mergeable', 'retryable'],
    ['pr_draft', 'terminal'],
    ['checks_failing', 'terminal'],
    ['not_ready', 'retryable'],
    ['gitlab_mr_lookup_failed', 'retryable'],
  ] as [AutoMergeIneligibilityCode, 'retryable' | 'terminal'][])('classifies %s as %s', (code, expected) => {
    expect(classifyAutoMergeIneligibility(code)).toBe(expected);
  });

  it.each([
    ['pr_merged', 'terminal'],
    ['pr_closed', 'terminal'],
    ['held_for_uat', 'terminal'],
    ['missing_pr_url', 'terminal'],
    ['blocker_label', 'terminal'],
    ['gitlab_mr_not_opened', 'terminal'],
  ] as [AutoMergeIneligibilityCode, 'retryable' | 'terminal'][])('classifies %s as %s', (code, expected) => {
    expect(classifyAutoMergeIneligibility(code)).toBe(expected);
  });
});

describe('isAutoMergeEligible codes', () => {
  const makeDeps = (overrides: Partial<AutoMergeEligibilityDeps> = {}): AutoMergeEligibilityDeps => ({
    getReviewStatus: () => makeReviewStatus(),
    getPullRequestState: async () => makeGitHubPrState(),
    getIssueLabels: async () => [],
    ...overrides,
  });

  it('returns not_ready when review status is not readyForMerge', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ readyForMerge: false }),
    }));
    expect(result).toEqual({ eligible: false, reason: 'review status is not readyForMerge', code: 'not_ready' });
  });

  it('returns held_for_uat when autoMerge is false', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ autoMerge: false }),
    }));
    expect(result).toEqual({ eligible: false, reason: 'held for UAT (auto-merge toggled off)', code: 'held_for_uat' });
  });

  it('returns missing_pr_url when PR URL is missing', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: undefined }),
    }));
    expect(result).toEqual({ eligible: false, reason: 'review status PR URL is missing or invalid', code: 'missing_pr_url' });
  });

  it('returns pr_merged when GitHub PR is already merged', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getPullRequestState: async () => makeGitHubPrState({ merged: true }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'pr_merged' });
  });

  it('returns pr_closed when GitHub PR is closed', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getPullRequestState: async () => makeGitHubPrState({ state: 'CLOSED' }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'pr_closed' });
  });

  it('returns pr_draft when GitHub PR is a draft', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getPullRequestState: async () => makeGitHubPrState({ draft: true }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'pr_draft' });
  });

  it('returns checks_failing when GitHub checks are failing', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getPullRequestState: async () => makeGitHubPrState({ checksFailed: true }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'checks_failing' });
  });

  it('returns checks_pending when GitHub checks are pending', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getPullRequestState: async () => makeGitHubPrState({ checksPending: true }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'checks_pending' });
  });

  it('returns not_mergeable when GitHub mergeable is false', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getPullRequestState: async () => makeGitHubPrState({ mergeable: false, mergeableState: 'blocked' }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'not_mergeable' });
  });

  it('returns blocker_label when issue carries a blocker label', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getIssueLabels: async () => ['needs-design'],
    }));
    expect(result).toEqual({ eligible: false, reason: 'issue carries blocker label: needs-design', code: 'blocker_label' });
  });

  it('returns pr_merged when GitLab MR is already merged', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'merged', draft: false }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'pr_merged' });
  });

  it('returns pr_closed when GitLab MR is closed', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'closed', draft: false }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'pr_closed' });
  });

  it('returns pr_draft when GitLab MR is a draft', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'opened', draft: true }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'pr_draft' });
  });

  it('returns not_mergeable when GitLab MR has conflicts', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'opened', draft: false, has_conflicts: true }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'not_mergeable' });
  });

  it('returns not_mergeable when GitLab detailed_merge_status is not mergeable', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'opened', draft: false, detailed_merge_status: 'ci_must_pass' }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'not_mergeable' });
  });

  it('returns not_mergeable when GitLab merge_status is not can_be_merged', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'opened', draft: false, merge_status: 'cannot_be_merged' }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'not_mergeable' });
  });

  it('returns gitlab_mr_lookup_failed when GitLab MR lookup throws', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => { throw new Error('glab not found'); },
    }));
    expect(result).toMatchObject({ eligible: false, code: 'gitlab_mr_lookup_failed' });
  });

  it('returns gitlab_mr_not_opened when GitLab MR state is neither opened, merged, nor closed', async () => {
    const result = await isAutoMergeEligible('PAN-1758', makeDeps({
      getReviewStatus: () => makeReviewStatus({ prUrl: 'https://gitlab.com/eltmon/panopticon-cli/-/merge_requests/1758' }),
      getGitLabMrState: async () => ({ state: 'locked', draft: false }),
    }));
    expect(result).toMatchObject({ eligible: false, code: 'gitlab_mr_not_opened' });
  });
});
