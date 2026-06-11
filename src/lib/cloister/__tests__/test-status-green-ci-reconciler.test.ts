import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileTestStatusFromGreenCiWithDeps,
  type TestStatusGreenCiDeps,
  type TestStatusGreenCiReviewStatus,
} from '../test-status-green-ci-reconciler.js';

function makeDeps(statuses: Record<string, TestStatusGreenCiReviewStatus>): TestStatusGreenCiDeps {
  return {
    isGitHubAppConfigured: vi.fn(() => true),
    loadReviewStatuses: vi.fn(() => statuses),
    getPullRequestState: vi.fn(() => Effect.succeed({
      state: 'OPEN' as const,
      merged: false,
      headSha: 'abcdef1234567890',
    })),
    getCiCheckRunsState: vi.fn(() => Effect.succeed({
      verdict: 'green' as const,
      successCount: 1,
      successfulRuns: [{ name: 'test', htmlUrl: 'https://github.com/run/1' }],
    })),
    setReviewStatusSync: vi.fn(),
    cooldowns: new Map<string, number>(),
    cooldownMs: 300_000,
    now: vi.fn(() => 1_000_000),
    log: vi.fn(),
    warn: vi.fn(),
  };
}

const candidate = {
  reviewStatus: 'passed',
  testStatus: 'pending',
  mergeStatus: 'pending',
  prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1658',
};

describe('reconcileTestStatusFromGreenCiWithDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks pending tests passed when the current PR HEAD has green CI check-runs', async () => {
    const deps = makeDeps({ 'PAN-1658': candidate });

    const actions = await reconcileTestStatusFromGreenCiWithDeps(deps);

    expect(deps.getPullRequestState).toHaveBeenCalledWith('eltmon', 'panopticon-cli', 1658);
    expect(deps.getCiCheckRunsState).toHaveBeenCalledWith('eltmon', 'panopticon-cli', 'abcdef1234567890');
    expect(deps.setReviewStatusSync).toHaveBeenCalledWith('PAN-1658', {
      testStatus: 'passed',
      testNotes: 'Reconciled from green GitHub Actions CI on abcdef12: test (https://github.com/run/1)',
    });
    expect(actions).toEqual([
      'Reconciled testStatus=pending → passed for PAN-1658 from green CI on PR #1658 @ abcdef12',
    ]);
  });

  it('leaves pending and red CI untouched, and only throttles the pending case', async () => {
    const pendingDeps = makeDeps({ 'PAN-1658': candidate });
    vi.mocked(pendingDeps.getCiCheckRunsState).mockReturnValueOnce(Effect.succeed({
      verdict: 'pending' as const,
      successCount: 1,
      successfulRuns: [{ name: 'test' }],
    }));

    await expect(reconcileTestStatusFromGreenCiWithDeps(pendingDeps)).resolves.toEqual([]);
    expect(pendingDeps.setReviewStatusSync).not.toHaveBeenCalled();
    expect(pendingDeps.cooldowns.get('PAN-1658')).toBe(1_300_000);

    const redDeps = makeDeps({ 'PAN-1658': candidate });
    vi.mocked(redDeps.getCiCheckRunsState).mockReturnValueOnce(Effect.succeed({
      verdict: 'red' as const,
      successCount: 1,
      successfulRuns: [{ name: 'build' }],
    }));

    await expect(reconcileTestStatusFromGreenCiWithDeps(redDeps)).resolves.toEqual([]);
    expect(redDeps.setReviewStatusSync).not.toHaveBeenCalled();
    expect(redDeps.cooldowns.get('PAN-1658')).toBe(1_300_000);
  });

  it('skips non-candidate review, test, merge, PR, and GitHub App states without mutation', async () => {
    const statuses: Record<string, TestStatusGreenCiReviewStatus> = {
      'PAN-1': { ...candidate, reviewStatus: 'pending' },
      'PAN-2': { ...candidate, testStatus: 'testing' },
      'PAN-3': { ...candidate, testStatus: 'passed' },
      'PAN-4': { ...candidate, testStatus: 'skipped' },
      'PAN-5': { ...candidate, testStatus: 'failed' },
      'PAN-6': { ...candidate, mergeStatus: 'merged' },
      'PAN-7': { ...candidate, mergeStatus: 'merging' },
      'PAN-8': { ...candidate, mergeStatus: 'queued' },
      'PAN-9': { ...candidate, mergeStatus: 'verifying' },
      'PAN-10': { ...candidate, prUrl: undefined },
      'PAN-11': { ...candidate, prUrl: 'not a github pr' },
    };
    const deps = makeDeps(statuses);

    await expect(reconcileTestStatusFromGreenCiWithDeps(deps)).resolves.toEqual([]);
    expect(deps.getPullRequestState).not.toHaveBeenCalled();
    expect(deps.getCiCheckRunsState).not.toHaveBeenCalled();
    expect(deps.setReviewStatusSync).not.toHaveBeenCalled();

    const disabledDeps = makeDeps({ 'PAN-1658': candidate });
    vi.mocked(disabledDeps.isGitHubAppConfigured).mockReturnValue(false);
    await expect(reconcileTestStatusFromGreenCiWithDeps(disabledDeps)).resolves.toEqual([]);
    expect(disabledDeps.loadReviewStatuses).not.toHaveBeenCalled();
  });

  it('checks the current PR HEAD and skips closed or merged PRs', async () => {
    const deps = makeDeps({ 'PAN-1658': candidate });
    vi.mocked(deps.getPullRequestState).mockReturnValueOnce(Effect.succeed({
      state: 'OPEN' as const,
      merged: false,
      headSha: 'newhead9876543210',
    }));

    await reconcileTestStatusFromGreenCiWithDeps(deps);

    expect(deps.getCiCheckRunsState).toHaveBeenCalledWith('eltmon', 'panopticon-cli', 'newhead9876543210');

    const closedDeps = makeDeps({ 'PAN-1658': candidate });
    vi.mocked(closedDeps.getPullRequestState).mockReturnValueOnce(Effect.succeed({
      state: 'CLOSED' as const,
      merged: false,
      headSha: 'abcdef1234567890',
    }));
    await expect(reconcileTestStatusFromGreenCiWithDeps(closedDeps)).resolves.toEqual([]);
    expect(closedDeps.getCiCheckRunsState).not.toHaveBeenCalled();
  });

  it('runs before pending-test dispatch so stale pending tests are reconciled instead of spawned', async () => {
    const statuses: Record<string, TestStatusGreenCiReviewStatus> = {
      'PAN-1658': { ...candidate },
    };
    const deps = makeDeps(statuses);
    vi.mocked(deps.setReviewStatusSync).mockImplementation((issueId, update) => {
      Object.assign(statuses[issueId], update);
    });
    const spawnTestRole = vi.fn();

    const actions = await reconcileTestStatusFromGreenCiWithDeps(deps);
    if (statuses['PAN-1658'].reviewStatus === 'passed' && statuses['PAN-1658'].testStatus === 'pending') {
      spawnTestRole('PAN-1658');
      statuses['PAN-1658'].testStatus = 'testing';
    }

    expect(actions).toEqual([
      'Reconciled testStatus=pending → passed for PAN-1658 from green CI on PR #1658 @ abcdef12',
    ]);
    expect(statuses['PAN-1658'].testStatus).toBe('passed');
    expect(spawnTestRole).not.toHaveBeenCalled();
  });

  it('suppresses repeat GitHub lookups during cooldown and throttles API errors', async () => {
    const cooledDeps = makeDeps({ 'PAN-1658': candidate });
    cooledDeps.cooldowns.set('PAN-1658', 1_000_001);
    await expect(reconcileTestStatusFromGreenCiWithDeps(cooledDeps)).resolves.toEqual([]);
    expect(cooledDeps.getPullRequestState).not.toHaveBeenCalled();

    const errorDeps = makeDeps({ 'PAN-1658': candidate });
    vi.mocked(errorDeps.getPullRequestState).mockReturnValueOnce(Effect.fail(new Error('rate limited')));
    await expect(reconcileTestStatusFromGreenCiWithDeps(errorDeps)).resolves.toEqual([]);
    expect(errorDeps.setReviewStatusSync).not.toHaveBeenCalled();
    expect(errorDeps.cooldowns.get('PAN-1658')).toBe(1_300_000);
    expect(errorDeps.warn).toHaveBeenCalledWith(
      'reconcileTestStatusFromGreenCi: PAN-1658 PR/CI lookup failed: rate limited',
    );
  });
});
