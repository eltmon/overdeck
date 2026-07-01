import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAll = vi.fn();
vi.mock('../../overdeck/review-status-sync.js', () => ({
  getAllReviewStatusesFromDb: () => mockGetAll(),
}));

import { getMergeBlockersPayload } from '../merge-blockers.js';

describe('getMergeBlockersPayload (PAN-1620, sandbox-safe — reads SQLite, no HTTP)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns only passed, unmerged PRs whose blockers are GitHub-native reasons', () => {
    mockGetAll.mockReturnValue({
      'PAN-1': { reviewStatus: 'passed', mergeStatus: 'pending', prUrl: 'u1', blockerReasons: [{ type: 'merge_conflict', summary: 'conflict' }] },
      'PAN-2': { reviewStatus: 'passed', mergeStatus: 'merged', blockerReasons: [{ type: 'failing_checks', summary: 'x' }] }, // merged → excluded
      'PAN-3': { reviewStatus: 'pending', blockerReasons: [{ type: 'merge_conflict', summary: 'x' }] }, // not passed → excluded
      'PAN-4': { reviewStatus: 'passed', mergeStatus: 'pending', blockerReasons: [{ type: 'reviewer_unresponsive', summary: 'x' }] }, // non-native reason → excluded
      'PAN-5': { reviewStatus: 'passed', mergeStatus: 'pending', blockerReasons: [] }, // no reasons → excluded
    });
    expect(getMergeBlockersPayload()).toEqual([
      { issueId: 'PAN-1', prUrl: 'u1', reasons: [{ type: 'merge_conflict', summary: 'conflict' }] },
    ]);
  });

  it('keeps only the native reasons when a PR mixes native + non-native blockers', () => {
    mockGetAll.mockReturnValue({
      'PAN-9': {
        reviewStatus: 'passed',
        mergeStatus: 'pending',
        prUrl: 'u9',
        blockerReasons: [
          { type: 'failing_checks', summary: 'CI red' },
          { type: 'reviewer_unresponsive', summary: 'ignore me' },
          { type: 'not_mergeable', summary: 'dirty' },
        ],
      },
    });
    expect(getMergeBlockersPayload()).toEqual([
      { issueId: 'PAN-9', prUrl: 'u9', reasons: [{ type: 'failing_checks', summary: 'CI red' }, { type: 'not_mergeable', summary: 'dirty' }] },
    ]);
  });

  it('returns empty when nothing is blocked', () => {
    mockGetAll.mockReturnValue({});
    expect(getMergeBlockersPayload()).toEqual([]);
  });
});
