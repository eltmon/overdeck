import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PAN-3917: merge-sync, control-settings, and auto-merge-eligibility still reach
// the record plane W3/W5 are deleting. This suite drives the executor entirely
// through injected deps, so the module graph is stubbed at those boundaries.
vi.mock('../../../../lib/overdeck/merge-sync.js', () => ({
  listDuePendingAutoMerges: vi.fn(() => []),
  markBlocked: vi.fn(() => true),
  markFailed: vi.fn(() => true),
  markMerged: vi.fn(() => true),
  markMergingBlocked: vi.fn(() => true),
  requeueToPending: vi.fn(() => true),
  transitionToMerging: vi.fn(() => true),
}));
vi.mock('../../../../lib/overdeck/control-settings.js', () => ({
  isMergeTrainEnabled: vi.fn(() => true),
}));
vi.mock('../../../../lib/cloister/auto-merge-eligibility.js', () => ({
  isAutoMergeEligible: vi.fn(async () => ({ eligible: true })),
}));
vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityTts: vi.fn() }));
vi.mock('../../../../lib/cloister/merge-gate.js', () => ({
  evaluateIssueMergeGate: vi.fn(async () => ({ ready: true })),
}));

import {
  AUTO_MERGE_EXECUTOR_INTERVAL_MS,
  FAILED_MERGE_MAX_RETRIES,
  _resetMergeRetryCountsForTests,
  startAutoMergeExecutor,
  stopAutoMergeExecutor,
  tickAutoMergeExecutor,
} from '../auto-merge-executor.js';
import type { PendingAutoMerge } from '../../../../lib/overdeck/merge-types.js';

const NOW = new Date('2026-05-25T10:00:00.000Z');

function pendingEntry(overrides: Partial<PendingAutoMerge> = {}): PendingAutoMerge {
  return {
    id: 1,
    issueId: 'PAN-1486',
    prUrl: 'https://github.com/eltmon/overdeck/pull/1486',
    prNumber: 1486,
    projectKey: 'overdeck',
    status: 'pending',
    scheduledMergeAt: '2026-05-25T09:59:59.000Z',
    scheduledAt: '2026-05-25T09:54:59.000Z',
    ...overrides,
  };
}

describe('auto-merge executor', () => {
  const originalDisable = process.env.OVERDECK_DISABLE_AUTO_MERGE;

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.OVERDECK_DISABLE_AUTO_MERGE;
  });

  afterEach(() => {
    stopAutoMergeExecutor();
    vi.useRealTimers();
    if (originalDisable === undefined) {
      delete process.env.OVERDECK_DISABLE_AUTO_MERGE;
    } else {
      process.env.OVERDECK_DISABLE_AUTO_MERGE = originalDisable;
    }
  });

  it('skips future-scheduled pending entries', async () => {
    const transition = vi.fn();
    const mergeIssue = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry({ scheduledMergeAt: '2026-05-25T10:00:01.000Z' })],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      transition,
      mergeIssue,
    });

    expect(transition).not.toHaveBeenCalled();
    expect(mergeIssue).not.toHaveBeenCalled();
  });

  it('skips the whole tick while the merge train is disabled', async () => {
    const transition = vi.fn();
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => true,
      transition,
      log,
    });

    expect(log).toHaveBeenCalledWith('[auto-merge] merge train disabled, skipping tick');
    expect(transition).not.toHaveBeenCalled();
  });

  it('defers before merge preparation and retries on the first tick after the deploy clears', async () => {
    let deployQueued = true;
    const isEligible = vi.fn(async () => ({ eligible: true as const }));
    const transition = vi.fn(() => true);
    const mergeIssue = vi.fn(async () => ({ success: true, outcome: 'merged' }));
    const markMerged = vi.fn();
    const log = vi.fn();
    const deps = {
      now: () => NOW,
      listEntries: () => [pendingEntry(), pendingEntry({ id: 2, issueId: 'PAN-1487' })],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => deployQueued,
      isEligible,
      transition,
      mergeIssue,
      markMerged,
      log,
    };

    await tickAutoMergeExecutor(deps);
    expect(isEligible).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(mergeIssue).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[auto-merge] deploy in progress, deferring 2 merge(s) before preparation',
    );

    deployQueued = false;
    await tickAutoMergeExecutor(deps);
    expect(isEligible).toHaveBeenCalledTimes(2);
    expect(mergeIssue).toHaveBeenCalledTimes(2);
    expect(markMerged).toHaveBeenCalledTimes(2);
  });

  it('marks due entries blocked when fire-time eligibility fails', async () => {
    const markBlocked = vi.fn();
    const transition = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: false, reason: 'CI checks failing on PR HEAD abc123' }),
      markBlocked,
      transition,
    });

    expect(markBlocked).toHaveBeenCalledWith(1, 'CI checks failing on PR HEAD abc123');
    expect(transition).not.toHaveBeenCalled();
  });

  it('skips merge execution when it loses the transition race', async () => {
    const mergeIssue = vi.fn();
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => false,
      mergeIssue,
      log,
    });

    expect(log).toHaveBeenCalledWith('[auto-merge] lost transition race for PAN-1486 (#1), skipping');
    expect(mergeIssue).not.toHaveBeenCalled();
  });

  it('marks successful merges as merged after invoking the dashboard merge path', async () => {
    const mergeIssue = vi.fn().mockResolvedValue({ success: true, statusCode: 200, message: 'Merged', outcome: 'merged' });
    const markMerged = vi.fn();
    const markFailed = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue,
      markMerged,
      markFailed,
    });

    expect(mergeIssue).toHaveBeenCalledWith('PAN-1486');
    expect(markMerged).toHaveBeenCalledWith(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('requeues queued merge results to pending without recording a failure', async () => {
    const markMerged = vi.fn();
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const requeueToPending = vi.fn().mockReturnValue(true);
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: true, statusCode: 200, message: 'Queued for merge', outcome: 'queued' }),
      markMerged,
      markFailed,
      announceFailure,
      requeueToPending,
      log,
    });

    const retryAt = new Date(NOW.getTime() + 60_000).toISOString();
    expect(markMerged).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(requeueToPending).toHaveBeenCalledWith(1, retryAt);
    expect(announceFailure).not.toHaveBeenCalled();
    expect(requeueToPending).toHaveBeenCalledWith(1, expect.any(String));
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('[auto-merge] merge for PAN-1486 accepted as queued; requeued for'),
    );
  });

  it('requeues deferred merges without consuming retry budget', async () => {
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const requeueToPending = vi.fn().mockReturnValue(true);
    const setMergeRetryCount = vi.fn();
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({
        success: false,
        statusCode: 409,
        error: 'Post-rebase verification deferred',
        deferred: true,
        outcome: 'queued',
      }),
      getMergeRetryCount: () => 2,
      setMergeRetryCount,
      markFailed,
      announceFailure,
      requeueToPending,
      log,
    });

    expect(requeueToPending).toHaveBeenCalledWith(1, new Date(NOW.getTime() + 60_000).toISOString());
    expect(setMergeRetryCount).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(announceFailure).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('requeued without consuming retry budget'));
  });

  it('requeues retryable failures below the circuit-breaker ceiling', async () => {
    const markMergingBlocked = vi.fn();
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const requeueToPending = vi.fn().mockReturnValue(true);
    const setMergeRetryCount = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, statusCode: 500, error: 'agent stopped', retryable: true }),
      getMergeRetryCount: () => 1,
      setMergeRetryCount,
      markMergingBlocked,
      markFailed,
      announceFailure,
      requeueToPending,
    });

    expect(setMergeRetryCount).toHaveBeenCalledWith('PAN-1486', 2);
    expect(requeueToPending).toHaveBeenCalledWith(1, new Date(NOW.getTime() + 60_000).toISOString());
    expect(markMergingBlocked).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(announceFailure).not.toHaveBeenCalled();
  });

  it('blocks retryable failures at the circuit-breaker ceiling', async () => {
    const markMergingBlocked = vi.fn().mockReturnValue(true);
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const requeueToPending = vi.fn();
    const setMergeRetryCount = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, statusCode: 500, error: 'agent stopped', retryable: true }),
      getMergeRetryCount: () => 3,
      setMergeRetryCount,
      markMergingBlocked,
      markFailed,
      announceFailure,
      requeueToPending,
    });

    const reason = 'Auto-merge for PAN-1486 blocked: agent stopped (retried 3 times — fix the underlying cause and re-schedule)';
    expect(markMergingBlocked).toHaveBeenCalledWith(1, reason);
    expect(announceFailure).toHaveBeenCalledWith('PAN-1486', reason);
    expect(setMergeRetryCount).not.toHaveBeenCalled();
    expect(requeueToPending).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('does not announce a circuit-breaker block when the durable transition loses its race', async () => {
    const announceFailure = vi.fn();
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, statusCode: 500, error: 'agent stopped', retryable: true }),
      getMergeRetryCount: () => 3,
      markMergingBlocked: () => false,
      announceFailure,
      log,
    });

    expect(announceFailure).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[auto-merge] lost circuit-breaker block race for PAN-1486 (#1), skipping announcement',
    );
  });

  it('marks non-retryable failed merges as failed and announces the failure', async () => {
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const requeueToPending = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      mergeGate: async () => ({ ready: true }),
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, statusCode: 500, error: 'merge exploded' }),
      markFailed,
      announceFailure,
      requeueToPending,
    });

    expect(markFailed).toHaveBeenCalledWith(1, 'merge exploded');
    expect(announceFailure).toHaveBeenCalledWith('PAN-1486', 'merge exploded');
    expect(requeueToPending).not.toHaveBeenCalled();
  });

  it('ticks every 30 seconds when started', async () => {
    const listEntries = vi.fn(() => []);

    expect(startAutoMergeExecutor({ listEntries })).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTO_MERGE_EXECUTOR_INTERVAL_MS - 1);
    expect(listEntries).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(listEntries).toHaveBeenCalledTimes(1);
  });

  it('does not start when OVERDECK_DISABLE_AUTO_MERGE=1', async () => {
    process.env.OVERDECK_DISABLE_AUTO_MERGE = '1';
    const listEntries = vi.fn(() => []);

    expect(startAutoMergeExecutor({ listEntries })).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTO_MERGE_EXECUTOR_INTERVAL_MS);

    expect(listEntries).not.toHaveBeenCalled();
  });

  // fix10: a peer dashboard shares the primary's database and forge; it starts
  // nothing that merges or that a merge sets off.
  it('does not start in a peer dashboard', async () => {
    process.env.OVERDECK_DISABLE_DEACON = '1';
    const listEntries = vi.fn(() => []);

    try {
      expect(startAutoMergeExecutor({ listEntries })).toBe(false);
      await vi.advanceTimersByTimeAsync(AUTO_MERGE_EXECUTOR_INTERVAL_MS);
      expect(listEntries).not.toHaveBeenCalled();
    } finally {
      delete process.env.OVERDECK_DISABLE_DEACON;
    }
  });

  it('blocks a scheduled merge whose PR stopped being ready (PAN-3917 FR-9)', async () => {
    const markBlocked = vi.fn(() => true);
    const transition = vi.fn(() => true);
    const mergeIssue = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true }),
      // A push landed between scheduling and the cooldown expiring, so checks
      // went back to pending — the forge, not a stored row, decides.
      mergeGate: async () => ({ ready: false, reason: 'CI checks still pending on PR HEAD abc123' }),
      markBlocked,
      transition,
      mergeIssue,
    });

    expect(markBlocked).toHaveBeenCalledWith(1, 'PAN-1486 is not ready to merge: CI checks still pending on PR HEAD abc123');
    expect(transition).not.toHaveBeenCalled();
    expect(mergeIssue).not.toHaveBeenCalled();
  });

  it('starts the retry budget over per process rather than persisting it', async () => {
    const requeueToPending = vi.fn(() => true);
    const markMergingBlocked = vi.fn(() => true);
    const base = {
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      hasPendingDeploy: async () => false,
      isEligible: async () => ({ eligible: true as const }),
      mergeGate: async () => ({ ready: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, retryable: true, error: 'transient' }),
      requeueToPending,
      markMergingBlocked,
    };

    _resetMergeRetryCountsForTests();
    for (let i = 0; i < FAILED_MERGE_MAX_RETRIES; i += 1) await tickAutoMergeExecutor(base);
    expect(requeueToPending).toHaveBeenCalledTimes(FAILED_MERGE_MAX_RETRIES);
    expect(markMergingBlocked).not.toHaveBeenCalled();

    await tickAutoMergeExecutor(base);
    expect(markMergingBlocked).toHaveBeenCalledOnce();

    // A restart forgets the budget: the circuit breaker exists to stop a hot
    // loop in THIS process, not to permanently condemn the issue.
    markMergingBlocked.mockClear();
    _resetMergeRetryCountsForTests();
    await tickAutoMergeExecutor(base);
    expect(markMergingBlocked).not.toHaveBeenCalled();
  });
});
