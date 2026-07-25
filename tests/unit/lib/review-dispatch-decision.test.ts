import { describe, expect, it } from 'vitest';
import { needsReviewDispatch } from '../../../src/lib/review-dispatch-decision.js';

const olderSpawn = '2026-07-25T10:00:00.000Z';
const newerRequest = '2026-07-25T10:01:00.000Z';

describe('needsReviewDispatch', () => {
  it('does not dispatch the PAN-3037 passed and ready snapshot', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'passed',
      readyForMerge: true,
      reviewRequestedAt: newerRequest,
      reviewSpawnedAt: olderSpawn,
    })).toBe(false);
  });

  it('does not dispatch a skipped review with an unserviced request', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'skipped',
      reviewRequestedAt: newerRequest,
      reviewSpawnedAt: olderSpawn,
    })).toBe(false);
  });

  it('does not dispatch a ready issue even when review is pending', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      readyForMerge: true,
      reviewRequestedAt: newerRequest,
      reviewSpawnedAt: olderSpawn,
    })).toBe(false);
  });

  it('dispatches a newer pending review request', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      reviewRequestedAt: newerRequest,
      reviewSpawnedAt: olderSpawn,
    })).toBe(true);
  });

  it('dispatches a pending request that has never spawned', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      reviewRequestedAt: newerRequest,
    })).toBe(true);
  });

  it('does not dispatch while reviewing or after merge', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'reviewing',
      reviewRequestedAt: newerRequest,
    })).toBe(false);
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      mergeStatus: 'merged',
      reviewRequestedAt: newerRequest,
    })).toBe(false);
  });

  it('does not dispatch without a durable request', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
    })).toBe(false);
  });
});
