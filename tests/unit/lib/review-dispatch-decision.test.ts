import { describe, expect, it } from 'vitest';
import {
  isReviewRequestStale,
  needsReviewDispatch,
  REVIEW_REQUEST_MAX_AGE_MS,
} from '../../../src/lib/review-dispatch-decision.js';

const olderSpawn = '2026-07-25T10:00:00.000Z';
const newerRequest = '2026-07-25T10:01:00.000Z';
const now = Date.parse('2026-07-25T11:00:00.000Z');

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
      now,
    })).toBe(true);
  });

  it('dispatches a pending request that has never spawned', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      reviewRequestedAt: newerRequest,
      now,
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

  it('ages out an unserviced request after the maximum age', () => {
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      reviewRequestedAt: new Date(now - REVIEW_REQUEST_MAX_AGE_MS - 1).toISOString(),
      now,
    })).toBe(false);
    expect(needsReviewDispatch({
      reviewStatus: 'pending',
      reviewRequestedAt: new Date(now - REVIEW_REQUEST_MAX_AGE_MS + 1).toISOString(),
      now,
    })).toBe(true);
  });
});

describe('isReviewRequestStale', () => {
  it('returns false without a durable request', () => {
    expect(isReviewRequestStale({ now })).toBe(false);
  });

  it('honors an injected maximum age', () => {
    expect(isReviewRequestStale({
      reviewRequestedAt: new Date(now - 1_001).toISOString(),
      now,
      maxAgeMs: 1_000,
    })).toBe(true);
    expect(isReviewRequestStale({
      reviewRequestedAt: new Date(now - 999).toISOString(),
      now,
      maxAgeMs: 1_000,
    })).toBe(false);
  });
});
