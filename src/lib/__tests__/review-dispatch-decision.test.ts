import { describe, it, expect } from 'vitest';
import { needsReviewDispatch } from '../review-dispatch-decision.js';

/**
 * PAN-1988 auto-heal regression lock. The work agent's `pan done` records a durable
 * `reviewRequestedAt` in the journal; the host reconciles on read and re-dispatches review when a
 * request is owed. If this decision regresses, a dashboard reload / dropped event / frozen deacon
 * silently strands the issue at "done but never reviewed" — exactly the failure this fixed.
 */
describe('needsReviewDispatch (PAN-1988 — auto-heal from durable journal intent)', () => {
  describe('DISPATCH owed', () => {
    it('first request, review never spawned', () => {
      expect(needsReviewDispatch({ reviewRequestedAt: '2026-06-20T10:00:00Z', reviewStatus: 'pending' })).toBe(true);
    });

    it('re-request after a blocked verdict (request newer than last spawn)', () => {
      expect(needsReviewDispatch({
        reviewRequestedAt: '2026-06-20T12:00:00Z',
        reviewSpawnedAt: '2026-06-20T10:00:00Z',
        reviewStatus: 'blocked',
      })).toBe(true);
    });

    it('re-request after a passed verdict with new commits', () => {
      expect(needsReviewDispatch({
        reviewRequestedAt: '2026-06-20T12:00:00Z',
        reviewSpawnedAt: '2026-06-20T10:00:00Z',
        reviewStatus: 'passed',
      })).toBe(true);
    });
  });

  describe('NO dispatch', () => {
    it('no request recorded', () => {
      expect(needsReviewDispatch({ reviewStatus: 'pending' })).toBe(false);
    });

    it('request already serviced (request older than the spawn it produced)', () => {
      expect(needsReviewDispatch({
        reviewRequestedAt: '2026-06-20T10:00:00Z',
        reviewSpawnedAt: '2026-06-20T10:00:05Z',
        reviewStatus: 'reviewing',
      })).toBe(false);
    });

    it('request equals the spawn timestamp (the request that produced the current review)', () => {
      expect(needsReviewDispatch({
        reviewRequestedAt: '2026-06-20T10:00:00Z',
        reviewSpawnedAt: '2026-06-20T10:00:00Z',
        reviewStatus: 'blocked',
      })).toBe(false);
    });

    it('a review is already in progress', () => {
      expect(needsReviewDispatch({ reviewRequestedAt: '2026-06-20T12:00:00Z', reviewStatus: 'reviewing' })).toBe(false);
    });

    it('the issue is already merged', () => {
      expect(needsReviewDispatch({
        reviewRequestedAt: '2026-06-20T12:00:00Z',
        reviewStatus: 'passed',
        mergeStatus: 'merged',
      })).toBe(false);
    });
  });
});
