import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewStatus } from '../../../src/lib/review-status.js';

const { mockListSessionNames } = vi.hoisted(() => ({
  mockListSessionNames: vi.fn(),
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  listSessionNames: mockListSessionNames,
}));

import { enrichReviewStatus } from '../../../src/lib/review-status-enrichment.js';

const status: ReviewStatus = {
  issueId: 'PAN-2988',
  reviewStatus: 'passed',
  testStatus: 'passed',
  verificationStatus: 'passed',
  mergeStatus: 'pending',
  readyForMerge: true,
  updatedAt: '2026-07-22T20:00:00.000Z',
};

describe('enrichReviewStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListSessionNames.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the unenriched status when session discovery exceeds five seconds', async () => {
    mockListSessionNames.mockReturnValue(Effect.never);

    const resultPromise = Effect.runPromise(enrichReviewStatus(status.issueId, status));
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(result).toEqual(status);
    expect(result).not.toHaveProperty('reviewSessionNames');
    expect(result).not.toHaveProperty('reviewCoordinatorSessionName');
    expect(result).not.toHaveProperty('reviewSubStatuses');
  });
});
