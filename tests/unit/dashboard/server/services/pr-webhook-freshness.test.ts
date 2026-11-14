import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isWebhookRelayRunningInLastSample: vi.fn(),
  resolveProjectForRepo: vi.fn(),
  getProjectSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(),
  invalidateRepoPullRequests: vi.fn(),
  invalidateOpenPullRequestsSnapshot: vi.fn(),
  scheduleDerivedStateRefreshForIssues: vi.fn(),
}));

vi.mock('../../../../../src/dashboard/server/services/system-health-service.js', () => ({
  isWebhookRelayRunningInLastSample: mocks.isWebhookRelayRunningInLastSample,
}));

vi.mock('../../../../../src/lib/ci/project-ci-observation.js', () => ({
  resolveProjectForRepo: mocks.resolveProjectForRepo,
}));

vi.mock('../../../../../src/lib/projects.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/projects.js')>();
  return { ...actual, getProjectSync: mocks.getProjectSync, resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync };
});

vi.mock('../../../../../src/lib/overdeck/pr-listing.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/overdeck/pr-listing.js')>();
  return { ...actual, invalidateRepoPullRequests: mocks.invalidateRepoPullRequests };
});

vi.mock('../../../../../src/lib/pipeline-membership-gather.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/pipeline-membership-gather.js')>();
  return { ...actual, invalidateOpenPullRequestsSnapshot: mocks.invalidateOpenPullRequestsSnapshot };
});

vi.mock('../../../../../src/dashboard/server/services/issue-service-singleton.js', () => ({
  getSharedIssueService: () => ({
    scheduleDerivedStateRefreshForIssues: mocks.scheduleDerivedStateRefreshForIssues,
  }),
}));

import {
  notePullRequestWebhook,
  PR_WEBHOOK_REFRESH_SPACING_MS,
  resetPrWebhookCoalescerForTests,
  startPrWebhookFreshness,
} from '../../../../../src/dashboard/server/services/pr-webhook-freshness.js';
import { setWebhookHealthProvider, webhooksHealthy } from '../../../../../src/lib/overdeck/pr-freshness.js';

describe('startPrWebhookFreshness (PAN-5224)', () => {
  afterEach(() => setWebhookHealthProvider(() => false));

  it('a peer dashboard never registers: webhooksHealthy() stays false even when the relay check would return true (ac1)', () => {
    mocks.isWebhookRelayRunningInLastSample.mockReturnValue(true);

    startPrWebhookFreshness({ isPeerDashboard: true });

    expect(webhooksHealthy()).toBe(false);
  });

  it('the primary dashboard registers the relay check, and the returned stop function restores false (ac2)', () => {
    mocks.isWebhookRelayRunningInLastSample.mockReturnValue(true);

    const stop = startPrWebhookFreshness({ isPeerDashboard: false });

    expect(webhooksHealthy()).toBe(true);

    stop();

    expect(webhooksHealthy()).toBe(false);
  });
});

describe('notePullRequestWebhook coalescer (PAN-5224)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPrWebhookCoalescerForTests();
    mocks.resolveProjectForRepo.mockReset();
    mocks.getProjectSync.mockReset();
    mocks.resolveProjectFromIssueSync.mockReset();
    mocks.invalidateRepoPullRequests.mockReset();
    mocks.invalidateOpenPullRequestsSnapshot.mockReset();
    mocks.scheduleDerivedStateRefreshForIssues.mockReset();
    mocks.resolveProjectForRepo.mockReturnValue({ projectKey: 'overdeck', repo: 'eltmon/overdeck', branch: 'main' });
    mocks.getProjectSync.mockReturnValue({ name: 'overdeck', path: '/project' });
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/project' });
  });

  afterEach(() => {
    resetPrWebhookCoalescerForTests();
    vi.useRealTimers();
  });

  it('with no prior fire, fires at once (ac1)', () => {
    notePullRequestWebhook('eltmon/overdeck', ['PAN-7'], 'pull_request:synchronize');

    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/project');
    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith(expect.stringContaining('project'));
    expect(mocks.invalidateOpenPullRequestsSnapshot).toHaveBeenCalledWith('eltmon', 'overdeck');
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledWith([{ identifier: 'PAN-7' }]);
  });

  it('also invalidates the issue\'s routed path for an issue_routing project (review A5)', () => {
    mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'overdeck', projectPath: '/routed-worktree' });

    notePullRequestWebhook('eltmon/overdeck', ['PAN-7'], 'pull_request:synchronize');

    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/project');
    expect(mocks.invalidateRepoPullRequests).toHaveBeenCalledWith('/routed-worktree');
  });

  it('20 events within 6s after a fire produce exactly one trailing fire with the union of issue ids (ac2)', async () => {
    notePullRequestWebhook('eltmon/overdeck', ['PAN-1'], 'first');
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      notePullRequestWebhook('eltmon/overdeck', [`PAN-${i + 2}`], 'burst');
    }
    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PR_WEBHOOK_REFRESH_SPACING_MS);

    expect(mocks.scheduleDerivedStateRefreshForIssues).toHaveBeenCalledTimes(2);
    const secondCallIds = (mocks.scheduleDerivedStateRefreshForIssues.mock.calls[1]![0] as Array<{ identifier: string }>)
      .map((entry) => entry.identifier)
      .sort();
    expect(secondCallIds).toEqual(Array.from({ length: 20 }, (_, i) => `PAN-${i + 2}`).sort());
  });

  it('one event every 500ms for 59.5s produces fires at least 6000ms apart, 10 fires by t=59999ms (ac3)', async () => {
    const fireTimes: number[] = [];
    mocks.scheduleDerivedStateRefreshForIssues.mockImplementation(() => {
      fireTimes.push(Date.now());
    });

    for (let t = 0; t <= 59_500; t += 500) {
      await vi.advanceTimersByTimeAsync(t === 0 ? 0 : 500);
      notePullRequestWebhook('eltmon/overdeck', [`PAN-${t}`], 'poll');
    }
    await vi.advanceTimersByTimeAsync(59_999 - 59_500);

    expect(fireTimes).toHaveLength(10);
    for (let i = 1; i < fireTimes.length; i++) {
      expect(fireTimes[i]! - fireTimes[i - 1]!).toBeGreaterThanOrEqual(PR_WEBHOOK_REFRESH_SPACING_MS);
    }
  });

  it('an untracked or unresolvable repo invalidates nothing and never throws (ac4)', () => {
    mocks.resolveProjectForRepo.mockReturnValue(null);

    expect(() => notePullRequestWebhook('unknown/repo', [], 'pull_request:opened')).not.toThrow();

    expect(mocks.invalidateRepoPullRequests).not.toHaveBeenCalled();
    expect(mocks.invalidateOpenPullRequestsSnapshot).not.toHaveBeenCalled();
    expect(mocks.scheduleDerivedStateRefreshForIssues).not.toHaveBeenCalled();
  });
});
