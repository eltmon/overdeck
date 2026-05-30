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

  it('marks due entries blocked when fire-time eligibility fails', async () => {
    const markBlocked = vi.fn();
    const transition = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
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

  it('marks failed merges as failed and announces the failure', async () => {
    const markFailed = vi.fn();
    const announceFailure = vi.fn();

    await tickAutoMergeExecutor({
      now: () => NOW,
      listEntries: () => [pendingEntry()],
      isPaused: () => false,
      isEligible: async () => ({ eligible: true }),
      transition: () => true,
      mergeIssue: async () => ({ success: false, statusCode: 500, error: 'merge exploded' }),
      markFailed,
      announceFailure,
    });

    expect(markFailed).toHaveBeenCalledWith(1, 'merge exploded');
    expect(announceFailure).toHaveBeenCalledWith('PAN-1486', 'merge exploded');
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
