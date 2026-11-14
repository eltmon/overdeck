/**
 * PAN-4457: `refreshIssuePullRequestStateNow` invalidates the resolved
 * project's cached PR listing and always schedules a derived-state refresh
 * for the issue, without ever throwing. PAN-5224: it (and a journaled
 * `merge.completed`) also invalidate the membership open-PR snapshot and
 * enqueue a project resource refresh — the gap a webhook-covered repo closes
 * through the coalescer, but a repo with no webhook coverage has nothing else
 * to close it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateRepoPullRequests: vi.fn(),
  invalidateOpenPullRequestsSnapshot: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  listProjectsSync: vi.fn(),
  scheduleDerivedStateRefreshForIssues: vi.fn(),
  enqueueProjectResourceRefresh: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/derived-issue-state.js', () => ({
  invalidateRepoPullRequests: mocks.invalidateRepoPullRequests,
}));
vi.mock('../../../../lib/pipeline-membership-gather.js', () => ({
  invalidateOpenPullRequestsSnapshot: mocks.invalidateOpenPullRequestsSnapshot,
}));
vi.mock('../../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  listProjectsSync: mocks.listProjectsSync,
}));
vi.mock('../issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({ scheduleDerivedStateRefreshForIssues: mocks.scheduleDerivedStateRefreshForIssues }),
}));
vi.mock('../project-resource-refresh-queue.js', () => ({
  enqueueProjectResourceRefresh: mocks.enqueueProjectResourceRefresh,
}));

import { invalidatePullRequestListingOnApproval, refreshIssuePullRequestStateNow } from '../issue-pr-refresh.js';

const PROJECT_CONFIG = { name: 'overdeck', path: '/repos/overdeck', github_repo: 'o/r' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listProjectsSync.mockReturnValue([{ key: 'overdeck', config: PROJECT_CONFIG }]);
});

describe('refreshIssuePullRequestStateNow', () => {
  it('invalidates the listing and membership snapshot, and enqueues review-door (ac3)', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repos/overdeck' });

    refreshIssuePullRequestStateNow('pan-7');

    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/overdeck');
    expect(mocks.invalidateOpenPullRequestsSnapshot).toHaveBeenCalledWith('o', 'r');
    expect(mocks.enqueueProjectResourceRefresh).toHaveBeenCalledWith(PROJECT_CONFIG, 'review-door');
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledWith([{ identifier: 'PAN-7' }]);
  });

  it('also invalidates the issue\'s routed path for an issue_routing project (review A5)', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repos/routed-worktree' });

    refreshIssuePullRequestStateNow('pan-7');

    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/overdeck');
    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/routed-worktree');
    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledTimes(2);
  });

  it('still schedules a refresh, without invalidating or enqueuing, when no project resolves', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);

    refreshIssuePullRequestStateNow('pan-7');

    expect(mocks.invalidateRepoPullRequests).not.toHaveBeenCalled();
    expect(mocks.invalidateOpenPullRequestsSnapshot).not.toHaveBeenCalled();
    expect(mocks.enqueueProjectResourceRefresh).not.toHaveBeenCalled();
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledWith([{ identifier: 'PAN-7' }]);
  });

  it('never throws when scheduleDerivedStateRefreshForIssues throws', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repos/overdeck' });
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
    expect(mocks.enqueueProjectResourceRefresh).not.toHaveBeenCalled();
  });

  it('leaves the listing alone for any other review.verdict entry (ac4)', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectPath: '/repos/overdeck' });

    invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7', data: { verdict: 'CHANGES_REQUESTED' } });
    invalidatePullRequestListingOnApproval({ type: 'review.requested', issueId: 'PAN-7', data: { verdict: 'APPROVED' } });
    invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7' });

    expect(mocks.invalidateRepoPullRequests).not.toHaveBeenCalled();
    expect(mocks.enqueueProjectResourceRefresh).not.toHaveBeenCalled();
  });

  it('never throws when the project cannot be resolved', () => {
    mocks.resolveProjectFromIssueSync.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => invalidatePullRequestListingOnApproval({ type: 'review.verdict', issueId: 'PAN-7', data: { verdict: 'APPROVED' } })).not.toThrow();
  });

  describe('merge.completed (PAN-5224)', () => {
    it('invalidates the listing and membership snapshot before enqueueing, and schedules a derived refresh (ac1, ac2)', () => {
      mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repos/overdeck' });

      invalidatePullRequestListingOnApproval({ type: 'merge.completed', issueId: 'PAN-7' });

      expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/overdeck');
      expect(mocks.invalidateOpenPullRequestsSnapshot).toHaveBeenCalledWith('o', 'r');
      expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledWith([{ identifier: 'PAN-7' }]);
      expect(mocks.enqueueProjectResourceRefresh).toHaveBeenCalledWith(PROJECT_CONFIG, 'merge.completed');

      const invalidateOrder = mocks.invalidateOpenPullRequestsSnapshot.mock.invocationCallOrder[0]!;
      const enqueueOrder = mocks.enqueueProjectResourceRefresh.mock.invocationCallOrder[0]!;
      expect(invalidateOrder).toBeLessThan(enqueueOrder);
    });

    it('also invalidates the issue\'s routed path for an issue_routing project (review A5)', () => {
      mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repos/routed-worktree' });

      invalidatePullRequestListingOnApproval({ type: 'merge.completed', issueId: 'PAN-7' });

      expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/overdeck');
      expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/repos/routed-worktree');
      expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledTimes(2);
    });

    it('does nothing and never throws when no project resolves (ac4)', () => {
      mocks.resolveProjectFromIssueSync.mockReturnValue(null);

      expect(() => invalidatePullRequestListingOnApproval({ type: 'merge.completed', issueId: 'PAN-7' })).not.toThrow();

      expect(mocks.invalidateRepoPullRequests).not.toHaveBeenCalled();
      expect(mocks.invalidateOpenPullRequestsSnapshot).not.toHaveBeenCalled();
      expect(mocks.scheduleDerivedStateRefreshForIssues).not.toHaveBeenCalled();
      expect(mocks.enqueueProjectResourceRefresh).not.toHaveBeenCalled();
    });

    it('never throws when a step fails', () => {
      mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/repos/overdeck' });
      mocks.enqueueProjectResourceRefresh.mockImplementation(() => {
        throw new Error('boom');
      });

      expect(() => invalidatePullRequestListingOnApproval({ type: 'merge.completed', issueId: 'PAN-7' })).not.toThrow();
    });
  });
});
