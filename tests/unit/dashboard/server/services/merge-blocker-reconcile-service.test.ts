import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockerReason, ReviewStatus } from '../../../../../src/lib/review-status.js';

const { mockGetMergeBlockerReconcileCandidates, mockRefreshMergeStateFromGitHub } = vi.hoisted(() => ({
  mockGetMergeBlockerReconcileCandidates: vi.fn(),
  mockRefreshMergeStateFromGitHub: vi.fn(() => Promise.resolve()),
}));

function candidatesEffect(candidates: ReturnType<typeof candidate>[]) {
  return Effect.succeed(candidates);
}

vi.mock('../../../../../src/lib/database/review-status-db.js', () => ({
  getMergeBlockerReconcileCandidates: mockGetMergeBlockerReconcileCandidates,
}));

vi.mock('../../../../../src/lib/webhook-handlers.js', () => ({
  refreshMergeStateFromGitHub: mockRefreshMergeStateFromGitHub,
}));

import {
  __reconcileOnceForTests,
  stopMergeBlockerReconcileService,
} from '../../../../../src/dashboard/server/services/merge-blocker-reconcile-service.js';

function candidate(overrides: {
  issueId: string;
  prUrl: string;
  blockerReasons?: BlockerReason[];
  readyForMerge?: boolean;
}): {
  issueId: string;
  prUrl: string | undefined;
  blockerReasons: BlockerReason[] | undefined;
  readyForMerge: boolean;
} {
  return {
    prUrl: overrides.prUrl,
    blockerReasons: overrides.blockerReasons,
    readyForMerge: overrides.readyForMerge ?? false,
    issueId: overrides.issueId,
  };
}

describe('merge-blocker reconcile service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T09:00:00.000Z'));
    mockGetMergeBlockerReconcileCandidates.mockReset();
    mockRefreshMergeStateFromGitHub.mockReset();
    mockRefreshMergeStateFromGitHub.mockResolvedValue(undefined);
    stopMergeBlockerReconcileService();
  });

  afterEach(() => {
    stopMergeBlockerReconcileService();
    vi.useRealTimers();
  });

  it('re-verifies merge_conflict blockers at most once per stale-flag interval', async () => {
    mockGetMergeBlockerReconcileCandidates.mockReturnValue(candidatesEffect([
      candidate({
        issueId: 'PAN-1',
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1',
        blockerReasons: [
          { type: 'merge_conflict', summary: 'conflicts', detectedAt: '2026-06-11T08:00:00.000Z' },
        ],
      }),
    ]));

    await __reconcileOnceForTests();
    await __reconcileOnceForTests();
    vi.advanceTimersByTime(9 * 60_000);
    await __reconcileOnceForTests();
    vi.advanceTimersByTime(61_000);
    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledTimes(2);
    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledWith('PAN-1', 'eltmon/panopticon-cli', 1);
  });

  it('bounds mergeability-blocker refresh fan-out', async () => {
    const releases: Array<() => void> = [];
    mockRefreshMergeStateFromGitHub.mockImplementation(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));
    mockGetMergeBlockerReconcileCandidates.mockReturnValue(candidatesEffect(
      Array.from({ length: 6 }, (_, index) => {
        const number = index + 1;
        return candidate({
          issueId: `PAN-${number}`,
          prUrl: `https://github.com/eltmon/panopticon-cli/pull/${number}`,
          blockerReasons: [
            { type: 'merge_conflict', summary: 'conflicts', detectedAt: '2026-06-11T08:00:00.000Z' },
          ],
        });
      }),
    ));

    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledTimes(4);

    while (mockRefreshMergeStateFromGitHub.mock.calls.length < 6) {
      const release = releases.shift();
      expect(release).toBeDefined();
      release!();
      await Promise.resolve();
      await Promise.resolve();
    }

    while (releases.length > 0) {
      releases.shift()!();
    }
    await Promise.resolve();
    await Promise.resolve();
  });

  it('skips rows with only non-mergeability blockers', async () => {
    // The selective DB query should never return this row, but the service
    // must still behave correctly if it does: only mergeability blockers trigger
    // a re-verification.
    mockGetMergeBlockerReconcileCandidates.mockReturnValue(candidatesEffect([
      candidate({
        issueId: 'PAN-2',
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/2',
        blockerReasons: [
          { type: 'failing_checks', summary: 'CI failed', detectedAt: '2026-06-11T08:00:00.000Z' },
        ],
      }),
    ]));

    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).not.toHaveBeenCalled();
  });

  it('keeps ready-with-no-blockers behavior unchanged', async () => {
    mockGetMergeBlockerReconcileCandidates.mockReturnValue(candidatesEffect([
      candidate({
        issueId: 'PAN-3',
        readyForMerge: true,
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/3',
      }),
    ]));

    await __reconcileOnceForTests();
    await __reconcileOnceForTests();
    vi.advanceTimersByTime(181_000);
    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledTimes(2);
    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledWith('PAN-3', 'eltmon/panopticon-cli', 3);
  });
});
