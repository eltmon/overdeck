import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { GitHubPullRequestState } from '../../github-app.js';
import type { ReviewStatus } from '../../review-status.js';
import { BLOCKER_LABELS, getPullRequestStateViaGh, isAutoMergeEligible } from '../auto-merge-eligibility.js';

const githubAppMocks = vi.hoisted(() => ({
  getPullRequestState: vi.fn(),
  isGitHubAppConfigured: vi.fn(() => true),
}));

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('../../github-app.js', () => githubAppMocks);

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFile = childProcessMocks.execFile;
  Object.assign(execFile, {
    [Symbol.for('nodejs.util.promisify.custom')]: vi.fn((command: string, args: string[], options: unknown) =>
      Promise.resolve(execFile(command, args, options))),
  });
  return { ...actual, execFile };
});

function makeReviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-1486',
    reviewStatus: 'passed',
    testStatus: 'passed',
    mergeStatus: 'pending',
    updatedAt: '2026-05-25T09:00:00.000Z',
    readyForMerge: true,
    prUrl: 'https://github.com/eltmon/overdeck/pull/1486',
    ...overrides,
  };
}

function makePrState(overrides: Partial<GitHubPullRequestState> = {}): GitHubPullRequestState {
  return {
    owner: 'eltmon',
    repo: 'overdeck',
    number: 1486,
    url: 'https://github.com/eltmon/overdeck/pull/1486',
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
  beforeEach(() => {
    vi.clearAllMocks();
    githubAppMocks.isGitHubAppConfigured.mockReturnValue(true);
    githubAppMocks.getPullRequestState.mockReturnValue(Effect.succeed(makePrState()));
  });

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
    expect(getPullRequestState).toHaveBeenCalledWith('eltmon', 'overdeck', 1486);
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

  it('returns ineligible when the GitHub PR state lookup throws', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getPullRequestState = vi.fn(async () => { throw new Error('gh auth required'); });
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getPullRequestState, getIssueLabels }))
      .resolves.toEqual({ eligible: false, reason: 'GitHub PR state lookup failed: gh auth required' });
    expect(getIssueLabels).not.toHaveBeenCalled();
  });

  it('uses gh to read GitHub PR state when the GitHub App is not configured', async () => {
    githubAppMocks.isGitHubAppConfigured.mockReturnValue(false);
    childProcessMocks.execFile.mockResolvedValue({
      stdout: JSON.stringify({
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        isDraft: false,
        headRefOid: 'abc1234',
        baseRefName: 'main',
        url: 'https://github.com/eltmon/overdeck/pull/1486',
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
          { __typename: 'StatusContext', state: 'SUCCESS' },
        ],
      }),
      stderr: '',
    });
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getIssueLabels }))
      .resolves.toEqual({ eligible: true });

    expect(childProcessMocks.execFile).toHaveBeenCalledWith('gh', [
      'pr',
      'view',
      '1486',
      '--repo',
      'eltmon/overdeck',
      '--json',
      'state,mergeable,mergeStateStatus,isDraft,headRefOid,baseRefName,url,statusCheckRollup',
    ], { encoding: 'utf-8' });
    expect(githubAppMocks.getPullRequestState).not.toHaveBeenCalled();
  });

  it('keeps the GitHub App reader when the App is configured', async () => {
    githubAppMocks.isGitHubAppConfigured.mockReturnValue(true);
    githubAppMocks.getPullRequestState.mockReturnValue(Effect.succeed(makePrState()));
    const getReviewStatus = vi.fn(() => makeReviewStatus());
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-1486', { getReviewStatus, getIssueLabels }))
      .resolves.toEqual({ eligible: true });

    expect(githubAppMocks.getPullRequestState).toHaveBeenCalledWith('eltmon', 'overdeck', 1486);
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      gh: { state: 'OPEN', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' },
      expected: {
        state: 'OPEN',
        merged: false,
        mergeable: false,
        mergeableState: 'dirty',
      },
    },
    {
      gh: { state: 'MERGED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' },
      expected: {
        state: 'CLOSED',
        merged: true,
        mergeable: true,
        mergeableState: 'clean',
      },
    },
    {
      gh: { state: 'CLOSED', mergeable: 'UNKNOWN', mergeStateStatus: null },
      expected: {
        state: 'CLOSED',
        merged: false,
        mergeable: null,
        mergeableState: null,
      },
    },
  ])('maps gh PR state into GitHubPullRequestState: %j', async ({ gh, expected }) => {
    childProcessMocks.execFile.mockResolvedValue({
      stdout: JSON.stringify({
        ...gh,
        isDraft: false,
        headRefOid: 'abc1234',
        baseRefName: 'main',
        url: 'https://github.com/eltmon/overdeck/pull/1486',
        statusCheckRollup: [],
      }),
      stderr: '',
    });

    await expect(getPullRequestStateViaGh('eltmon', 'overdeck', 1486))
      .resolves.toMatchObject(expected);
  });

  it('maps gh statusCheckRollup pending and failed states like the GitHub App reader', async () => {
    childProcessMocks.execFile.mockResolvedValue({
      stdout: JSON.stringify({
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        isDraft: false,
        headRefOid: 'abc1234',
        baseRefName: 'main',
        url: 'https://github.com/eltmon/overdeck/pull/1486',
        statusCheckRollup: [
          { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
          { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
          { __typename: 'StatusContext', state: 'PENDING' },
          { __typename: 'StatusContext', state: 'ERROR' },
        ],
      }),
      stderr: '',
    });

    await expect(getPullRequestStateViaGh('eltmon', 'overdeck', 1486))
      .resolves.toMatchObject({
        checksPending: true,
        checksFailed: true,
      });
  });

  it('returns eligible for a mergeable GitLab MR', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({
      prUrl: 'https://gitlab.com/eltmon/mind-your-now/-/merge_requests/62',
    }));
    const getGitLabMrState = vi.fn(async () => ({
      state: 'opened',
      draft: false,
      detailed_merge_status: 'mergeable',
    }));
    const getPullRequestState = vi.fn(async () => makePrState());
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('MIN-831', {
      getReviewStatus,
      getGitLabMrState,
      getPullRequestState,
      getIssueLabels,
    })).resolves.toEqual({ eligible: true });

    expect(getGitLabMrState).toHaveBeenCalledWith('eltmon/mind-your-now', 62);
    expect(getPullRequestState).not.toHaveBeenCalled();
  });

  it.each([
    { state: 'merged', reason: 'MR is already merged' },
    { state: 'closed', reason: 'MR is closed' },
    { state: 'opened', draft: true, reason: 'MR is a draft' },
    { state: 'opened', has_conflicts: true, reason: 'MR has conflicts' },
    { state: 'opened', detailed_merge_status: 'ci_still_running', reason: 'MR is not mergeable (detailed_merge_status=ci_still_running)' },
  ])('rejects a GitLab MR in a non-mergeable state: %j', async (overrides) => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({
      prUrl: 'https://gitlab.com/eltmon/mind-your-now/-/merge_requests/62',
    }));
    const getGitLabMrState = vi.fn(async () => ({
      state: 'opened',
      draft: false,
      ...overrides,
    }));
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('MIN-831', {
      getReviewStatus,
      getGitLabMrState,
      getIssueLabels,
    })).resolves.toEqual({ eligible: false, reason: overrides.reason });
  });

  it('falls back to merge_status when detailed_merge_status is absent', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({
      prUrl: 'https://gitlab.com/eltmon/mind-your-now/-/merge_requests/62',
    }));
    const getGitLabMrState = vi.fn(async () => ({
      state: 'opened',
      draft: false,
      merge_status: 'can_be_merged',
    }));
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('MIN-831', {
      getReviewStatus,
      getGitLabMrState,
      getIssueLabels,
    })).resolves.toEqual({ eligible: true });
  });

  it('returns ineligible when the GitLab MR state lookup throws', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({
      prUrl: 'https://gitlab.com/eltmon/mind-your-now/-/merge_requests/62',
    }));
    const getGitLabMrState = vi.fn(async () => { throw new Error('glab not found'); });
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('MIN-831', {
      getReviewStatus,
      getGitLabMrState,
      getIssueLabels,
    })).resolves.toEqual({ eligible: false, reason: 'GitLab MR state lookup failed: glab not found' });
  });

  it('self-hosted GitLab MRs are detected by path and parsed for project path', async () => {
    const getReviewStatus = vi.fn(() => makeReviewStatus({
      prUrl: 'https://git.example.com/g/r/-/merge_requests/5',
    }));
    const getGitLabMrState = vi.fn(async () => ({
      state: 'opened',
      draft: false,
      detailed_merge_status: 'mergeable',
    }));
    const getIssueLabels = vi.fn(async () => []);

    await expect(isAutoMergeEligible('PAN-SELF', {
      getReviewStatus,
      getGitLabMrState,
      getIssueLabels,
    })).resolves.toEqual({ eligible: true });

    expect(getGitLabMrState).toHaveBeenCalledWith('g/r', 5);
  });
});
