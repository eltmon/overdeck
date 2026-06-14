import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_MERGE_EXECUTOR_INTERVAL_MS,
  startAutoMergeExecutor,
  stopAutoMergeExecutor,
  tickAutoMergeExecutor,
} from '../auto-merge-executor.js';
import type { PendingAutoMerge } from '../../../../lib/database/pending-auto-merges-db.js';

const NOW = new Date('2026-05-25T10:00:00.000Z');

function pendingEntry(overrides: Partial<PendingAutoMerge> = {}): PendingAutoMerge {
  return {
    id: 1,
    issueId: 'PAN-1486',
    prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1486',
    prNumber: 1486,
    projectKey: 'panopticon-cli',
    status: 'pending',
    scheduledMergeAt: '2026-05-25T09:59:59.000Z',
    scheduledAt: '2026-05-25T09:54:59.000Z',
    ...overrides,
  };
}

describe('auto-merge executor', () => {
  const originalDisable = process.env.PANOPTICON_DISABLE_AUTO_MERGE;

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.PANOPTICON_DISABLE_AUTO_MERGE;
  });

  afterEach(() => {
    stopAutoMergeExecutor();
    vi.useRealTimers();
    if (originalDisable === undefined) {
      delete process.env.PANOPTICON_DISABLE_AUTO_MERGE;
    } else {
      process.env.PANOPTICON_DISABLE_AUTO_MERGE = originalDisable;
    }
  });

  it('skips future-scheduled pending entries', async () => {
    const transition = vi.fn();
    const mergeIssue = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry({ scheduledMergeAt: '2026-05-25T10:00:01.000Z' })],
      isPaused: () => false,
      transition,
      mergeIssue,
    });

    expect(transition).not.toHaveBeenCalled();
    expect(mergeIssue).not.toHaveBeenCalled();
  });

  it('skips the whole tick while Flywheel is paused', async () => {
    const transition = vi.fn();
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => true,
      transition,
      log,
    });

    expect(log).toHaveBeenCalledWith('[auto-merge] flywheel paused, skipping tick');
    expect(transition).not.toHaveBeenCalled();
  });

  it('marks due entries blocked when fire-time eligibility fails with a terminal reason', async () => {
    const markBlocked = vi.fn();
    const transition = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      isEligible: async () => ({ eligible: false, reason: 'PR is closed', code: 'pr_closed' }),
      markBlocked,
      transition,
    });

    expect(markBlocked).toHaveBeenCalledWith(1, 'PR is closed');
    expect(transition).not.toHaveBeenCalled();
  });

  it('skips merge execution when it loses the transition race', async () => {
    const mergeIssue = vi.fn();
    const log = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => false,
      mergeIssue,
      log,
    });

    expect(log).toHaveBeenCalledWith('[auto-merge] lost transition race for PAN-1486 (#1), skipping');
    expect(mergeIssue).not.toHaveBeenCalled();
  });

  it('marks successful merges as merged after invoking the dashboard merge path', async () => {
    const mergeIssue = vi.fn().mockResolvedValue({ success: true, statusCode: 200, message: 'Merged', mergeStatus: 'merged' });
    const markMerged = vi.fn();
    const markFailed = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
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
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: true, statusCode: 200, message: 'Queued for merge', mergeStatus: 'queued' }),
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

  it('marks failed merges as failed and announces the failure when attempts are already exhausted', async () => {
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const requeueToPending = vi.fn();
    const incrementAttempts = vi.fn().mockReturnValue(true);

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry({ attempts: 2 })],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, statusCode: 500, error: 'merge exploded' }),
      incrementAttempts,
      requeueToPending,
      markFailed,
      announceFailure,
    });

    expect(requeueToPending).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledWith(1, 'merge exploded');
    expect(announceFailure).toHaveBeenCalledWith('PAN-1486', 'merge exploded');
  });

  it('defers transiently-ineligible entries with backoff instead of blocking', async () => {
    const deferPendingAutoMerge = vi.fn().mockReturnValue(true);
    const markBlocked = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      isEligible: async () => ({ eligible: false, reason: 'CI checks still pending', code: 'checks_pending' }),
      deferPendingAutoMerge,
      markBlocked,
    });

    expect(deferPendingAutoMerge).toHaveBeenCalledWith(1, new Date(NOW.getTime() + 60_000).toISOString());
    expect(markBlocked).not.toHaveBeenCalled();
  });

  it('blocks terminally-ineligible entries', async () => {
    const markBlocked = vi.fn().mockReturnValue(true);
    const deferPendingAutoMerge = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      isEligible: async () => ({ eligible: false, reason: 'PR is closed', code: 'pr_closed' }),
      markBlocked,
      deferPendingAutoMerge,
    });

    expect(markBlocked).toHaveBeenCalledWith(1, 'PR is closed');
    expect(deferPendingAutoMerge).not.toHaveBeenCalled();
  });

  it('blocks transiently-ineligible entries past the staleness ceiling', async () => {
    const markBlocked = vi.fn().mockReturnValue(true);
    const deferPendingAutoMerge = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry({ scheduledAt: '2026-05-25T07:00:00.000Z' })],
      isPaused: () => false,
      isEligible: async () => ({ eligible: false, reason: 'PR is not mergeable', code: 'not_mergeable' }),
      markBlocked,
      deferPendingAutoMerge,
    });

    expect(markBlocked).toHaveBeenCalledWith(1, 'stuck: ineligible over 2h');
    expect(deferPendingAutoMerge).not.toHaveBeenCalled();
  });

  it('caps recoverable merge failures at 3 attempts and announces the final failure', async () => {
    const incrementAttempts = vi.fn().mockReturnValue(true);
    const requeueToPending = vi.fn().mockReturnValue(true);
    const markFailed = vi.fn();
    const announceFailure = vi.fn();
    const mergeIssue = vi.fn().mockResolvedValue({ success: false, statusCode: 500, error: 'merge exploded' });

    // First failure: attempts 0 -> 1, requeue
    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry({ attempts: 0 })],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue,
      incrementAttempts,
      requeueToPending,
      markFailed,
      announceFailure,
    });

    expect(incrementAttempts).toHaveBeenCalledTimes(1);
    expect(requeueToPending).toHaveBeenCalledWith(1, new Date(NOW.getTime() + 60_000).toISOString());
    expect(markFailed).not.toHaveBeenCalled();
    expect(announceFailure).not.toHaveBeenCalled();

    // Second failure: attempts 1 -> 2, requeue
    await tickAutoMergeExecutor({
      now: () => new Date(NOW.getTime() + 60_000),
      listEntries: () => [pendingEntry({ attempts: 1 })],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue,
      incrementAttempts,
      requeueToPending,
      markFailed,
      announceFailure,
    });

    expect(incrementAttempts).toHaveBeenCalledTimes(2);
    expect(requeueToPending).toHaveBeenLastCalledWith(1, new Date(NOW.getTime() + 60_000 + 120_000).toISOString());
    expect(markFailed).not.toHaveBeenCalled();
    expect(announceFailure).not.toHaveBeenCalled();

    // Third failure: attempts 2 -> 3, mark failed + announce
    await tickAutoMergeExecutor({
      now: () => new Date(NOW.getTime() + 60_000 + 120_000),
      listEntries: () => [pendingEntry({ attempts: 2 })],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue,
      incrementAttempts,
      requeueToPending,
      markFailed,
      announceFailure,
    });

    expect(incrementAttempts).toHaveBeenCalledTimes(3);
    expect(markFailed).toHaveBeenCalledWith(1, 'merge exploded');
    expect(announceFailure).toHaveBeenCalledWith('PAN-1486', 'merge exploded');
  });

  it('resurrects blocked entries that become eligible again', async () => {
    const resurrectStrandedAutoMerge = vi.fn().mockReturnValue(true);
    const isEligible = vi.fn().mockResolvedValue({ eligible: true });

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [],
      listProblemEntries: () => [pendingEntry({ status: 'blocked' })],
      isPaused: () => false,
      isEligible,
      resurrectStrandedAutoMerge,
    });

    expect(isEligible).toHaveBeenCalledWith('PAN-1486');
    expect(resurrectStrandedAutoMerge).toHaveBeenCalledWith(1, NOW.toISOString());
  });

  it('does not resurrect failed entries at the attempt cap', async () => {
    const resurrectStrandedAutoMerge = vi.fn();
    const isEligible = vi.fn().mockResolvedValue({ eligible: true });

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [],
      listProblemEntries: () => [pendingEntry({ status: 'failed', attempts: 3 })],
      isPaused: () => false,
      isEligible,
      resurrectStrandedAutoMerge,
    });

    expect(isEligible).not.toHaveBeenCalled();
    expect(resurrectStrandedAutoMerge).not.toHaveBeenCalled();
  });

  it('does not resurrect entries that are still ineligible', async () => {
    const resurrectStrandedAutoMerge = vi.fn();
    const isEligible = vi.fn().mockResolvedValue({ eligible: false, reason: 'CI pending', code: 'checks_pending' });

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [],
      listProblemEntries: () => [pendingEntry({ status: 'blocked' })],
      isPaused: () => false,
      isEligible,
      resurrectStrandedAutoMerge,
    });

    expect(isEligible).toHaveBeenCalledWith('PAN-1486');
    expect(resurrectStrandedAutoMerge).not.toHaveBeenCalled();
  });

  it('orders multiple due entries by PAN-1691 conflict-aware order', async () => {
    const entries = [
      pendingEntry({ id: 1, issueId: 'PAN-1' }),
      pendingEntry({ id: 2, issueId: 'PAN-2' }),
      pendingEntry({ id: 3, issueId: 'PAN-3' }),
    ];
    const mergeIssue = vi.fn().mockResolvedValue({ success: true, mergeStatus: 'merged' });
    const markMerged = vi.fn();

    const computeMergeOrderMeta = vi.fn().mockResolvedValue([
      { ...entries[0], footprint: 2, conflictCount: 1 }, // conflicts with PAN-2
      { ...entries[1], footprint: 5, conflictCount: 1 }, // conflicts with PAN-1, broader footprint
      { ...entries[2], footprint: 1, conflictCount: 0 }, // disjoint
    ]);

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => entries,
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue,
      markMerged,
      computeMergeOrderMeta,
    });

    expect(computeMergeOrderMeta).toHaveBeenCalled();
    // Disjoint PAN-3 should be attempted first, then broader-footprint PAN-2, then PAN-1.
    expect(mergeIssue).toHaveBeenNthCalledWith(1, 'PAN-3');
    expect(mergeIssue).toHaveBeenNthCalledWith(2, 'PAN-2');
    expect(mergeIssue).toHaveBeenNthCalledWith(3, 'PAN-1');
  });

  it('skips merge-order computation for zero or one due entries', async () => {
    const mergeIssue = vi.fn().mockResolvedValue({ success: true, mergeStatus: 'merged' });
    const markMerged = vi.fn();
    const computeMergeOrderMeta = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue,
      markMerged,
      computeMergeOrderMeta,
    });

    expect(computeMergeOrderMeta).not.toHaveBeenCalled();
    expect(mergeIssue).toHaveBeenCalledWith('PAN-1486');
  });

  it('ticks every 30 seconds when started', async () => {
    const listEntries = vi.fn(() => []);

    expect(startAutoMergeExecutor({ listEntries })).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTO_MERGE_EXECUTOR_INTERVAL_MS - 1);
    expect(listEntries).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(listEntries).toHaveBeenCalledTimes(1);
  });

  it('does not start when PANOPTICON_DISABLE_AUTO_MERGE=1', async () => {
    process.env.PANOPTICON_DISABLE_AUTO_MERGE = '1';
    const listEntries = vi.fn(() => []);

    expect(startAutoMergeExecutor({ listEntries })).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTO_MERGE_EXECUTOR_INTERVAL_MS);

    expect(listEntries).not.toHaveBeenCalled();
  });
});
