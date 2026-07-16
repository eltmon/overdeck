import { describe, expect, it } from 'vitest';
import { completedReviewSnapshotAfterCoordinatorExit } from '../../../../src/lib/cloister/deacon-review-status.js';

describe('completedReviewSnapshotAfterCoordinatorExit', () => {
  it('restores passed review and test verdicts instead of re-dispatching', () => {
    expect(completedReviewSnapshotAfterCoordinatorExit({
      history: [
        { type: 'review', status: 'passed', timestamp: '2026-07-13T05:20:14.913Z' },
        { type: 'test', status: 'passed', timestamp: '2026-07-13T05:41:26.447Z' },
        { type: 'review', status: 'reviewing', timestamp: '2026-07-14T05:55:32.966Z' },
      ],
    })).toEqual(expect.objectContaining({
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewRetryCount: 0,
    }));
  });

  it('does not manufacture a verdict when review never passed', () => {
    expect(completedReviewSnapshotAfterCoordinatorExit({
      history: [{ type: 'review', status: 'failed', timestamp: '2026-07-13T05:20:14.913Z' }],
    })).toBeNull();
  });
});
