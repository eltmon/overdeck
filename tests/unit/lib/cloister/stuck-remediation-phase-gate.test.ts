/**
 * PAN-2581: stuck remediation must not poke/resume a work agent whose issue the
 * pipeline currently owns — review in flight, a passed review awaiting test, or
 * an un-serviced durable review request. Poking those agents re-runs `pan done`,
 * which re-arms review and clobbers landed verdicts.
 */

import { describe, it, expect } from 'vitest';
import { shouldSkipReviewStatus } from '../../../../src/lib/cloister/stuck-remediation.js';
import type { ReviewStatus } from '../../../../src/lib/review-status.js';

function status(overrides: Partial<ReviewStatus>): ReviewStatus {
  return {
    issueId: 'PAN-9999',
    reviewStatus: 'pending',
    testStatus: 'pending',
    readyForMerge: false,
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  } as ReviewStatus;
}

describe('shouldSkipReviewStatus phase gate (PAN-2581)', () => {
  it('skips while review is in flight', () => {
    expect(shouldSkipReviewStatus(status({ reviewStatus: 'reviewing' }))).toBe(true);
  });

  it('skips a passed review awaiting the test role', () => {
    expect(shouldSkipReviewStatus(status({ reviewStatus: 'passed' }))).toBe(true);
  });

  it('skips an un-serviced durable review request (pan done already ran)', () => {
    expect(
      shouldSkipReviewStatus(status({ reviewStatus: 'pending', reviewRequestedAt: '2026-07-12T01:32:07.847Z' })),
    ).toBe(true);
  });

  it('does NOT skip a genuinely mid-work agent (pending, never requested review)', () => {
    expect(shouldSkipReviewStatus(status({ reviewStatus: 'pending' }))).toBe(false);
  });

  it('still skips rework states (owned by the wedged-rework path, not stage pokes)', () => {
    expect(shouldSkipReviewStatus(status({ reviewStatus: 'blocked' }))).toBe(true);
    expect(shouldSkipReviewStatus(status({ testStatus: 'failed' }))).toBe(true);
  });

  it('does not skip when there is no status at all', () => {
    expect(shouldSkipReviewStatus(null)).toBe(false);
  });
});
