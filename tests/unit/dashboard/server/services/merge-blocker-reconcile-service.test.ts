import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../../../src/lib/review-status.js';

const { mockGetAllReviewStatusesFromDb, mockRefreshMergeStateFromGitHub } = vi.hoisted(() => ({
  mockGetAllReviewStatusesFromDb: vi.fn(),
  mockRefreshMergeStateFromGitHub: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../../../src/lib/database/review-status-db.js', () => ({
  getAllReviewStatusesFromDb: mockGetAllReviewStatusesFromDb,
}));

vi.mock('../../../../../src/lib/webhook-handlers.js', () => ({
  refreshMergeStateFromGitHub: mockRefreshMergeStateFromGitHub,
}));

import {
  __reconcileOnceForTests,
  stopMergeBlockerReconcileService,
} from '../../../../../src/dashboard/server/services/merge-blocker-reconcile-service.js';

function status(overrides: Partial<ReviewStatus>): ReviewStatus {
  return {
    issueId: 'PAN-1',
    reviewStatus: 'passed',
    testStatus: 'passed',
    updatedAt: '2026-06-11T09:00:00.000Z',
    readyForMerge: false,
    ...overrides,
  };
}

describe('merge-blocker reconcile service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T09:00:00.000Z'));
    mockGetAllReviewStatusesFromDb.mockReset();
    mockRefreshMergeStateFromGitHub.mockClear();
    stopMergeBlockerReconcileService();
  });

  afterEach(() => {
    stopMergeBlockerReconcileService();
    vi.useRealTimers();
  });

  it('re-verifies merge_conflict blockers at most once per stale-flag interval', async () => {
    mockGetAllReviewStatusesFromDb.mockReturnValue({
      'PAN-1': status({
        issueId: 'PAN-1',
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/1',
        blockerReasons: [
          { type: 'merge_conflict', summary: 'conflicts', detectedAt: '2026-06-11T08:00:00.000Z' },
        ],
      }),
    });

    await __reconcileOnceForTests();
    await __reconcileOnceForTests();
    vi.advanceTimersByTime(9 * 60_000);
    await __reconcileOnceForTests();
    vi.advanceTimersByTime(61_000);
    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledTimes(2);
    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledWith('PAN-1', 'eltmon/panopticon-cli', 1);
  });

  it('skips rows with only non-mergeability blockers', async () => {
    mockGetAllReviewStatusesFromDb.mockReturnValue({
      'PAN-2': status({
        issueId: 'PAN-2',
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/2',
        blockerReasons: [
          { type: 'failing_checks', summary: 'CI failed', detectedAt: '2026-06-11T08:00:00.000Z' },
        ],
      }),
    });

    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).not.toHaveBeenCalled();
  });

  it('keeps ready-with-no-blockers behavior unchanged', async () => {
    mockGetAllReviewStatusesFromDb.mockReturnValue({
      'PAN-3': status({
        issueId: 'PAN-3',
        readyForMerge: true,
        prUrl: 'https://github.com/eltmon/panopticon-cli/pull/3',
        blockerReasons: undefined,
      }),
    });

    await __reconcileOnceForTests();
    await __reconcileOnceForTests();
    vi.advanceTimersByTime(181_000);
    await __reconcileOnceForTests();

    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledTimes(2);
    expect(mockRefreshMergeStateFromGitHub).toHaveBeenCalledWith('PAN-3', 'eltmon/panopticon-cli', 3);
  });
});
