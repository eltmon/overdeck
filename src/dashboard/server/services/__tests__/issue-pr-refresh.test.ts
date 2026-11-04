/**
 * PAN-4457: `refreshIssuePullRequestStateNow` invalidates the resolved
 * project's cached PR listing and always schedules a derived-state refresh
 * for the issue, without ever throwing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateRepoPullRequests: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  scheduleDerivedStateRefreshForIssues: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/derived-issue-state.js', () => ({
  invalidateRepoPullRequests: mocks.invalidateRepoPullRequests,
}));
vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));
vi.mock('../issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ scheduleDerivedStateRefreshForIssues: mocks.scheduleDerivedStateRefreshForIssues }),
}));

import { invalidatePullRequestListingOnApproval, refreshIssuePullRequestStateNow } from '../issue-pr-refresh.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('refreshIssuePullRequestStateNow', () => {
  it('invalidates the resolved project path and schedules the upper-cased issue id', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repos/overdeck' });

    refreshIssuePullRequestStateNow('pan-7');

    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/overdeck');
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledWith([{ identifier: 'PAN-7' }]);
  });

  it('still schedules a refresh, without invalidating, when no project resolves', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);

    refreshIssuePullRequestStateNow('pan-7');

    expect(mocks.invalidateRepoPullRequests).not.toHaveBeenCalled();
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledWith([{ identifier: 'PAN-7' }]);
  });

  it('never throws when scheduleDerivedStateRefreshForIssues throws', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repos/overdeck' });
    mocks.scheduleDerivedStateRefreshForIssues.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => refreshIssuePullRequestStateNow('pan-7')).not.toThrow();
  });
});

describe('invalidatePullRequestListingOnApproval (PAN-5036)', () => {
  it('drops the repo listing when an APPROVED review verdict is journaled', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repos/overdeck' });

    invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7', data: { verdict: 'APPROVED' } });

    expect(mocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-7');
    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/overdeck');
    expect(mocks.scheduleDerivedStateRefreshForIssues).not.toHaveBeenCalled();
  });

  it('leaves the listing alone for any other journal entry', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repos/overdeck' });

    invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7', data: { verdict: 'CHANGES_REQUESTED' } });
    invalidatePullRequestListingOnApproval({ type: 'review.requested', issueId: 'PAN-7', data: { verdict: 'APPROVED' } });
    invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7' });

    expect(mocks.invalidateRepoPullRequests).not.toHaveBeenCalled();
  });

  it('never throws when the project cannot be resolved', () => {
    mocks.resolveProjectFromIssueSync.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7', data: { verdict: 'APPROVED' } })).not.toThrow();
  });
});
