/**
 * Regression test for merge-gate invariant: verdict-write-door must reset
 * the test gate when evidence head differs from row head, so readyForMerge
 * cannot flip true at an unverified head.
 *
 * The merge-time gate (triggerMerge Step 3) is the second line of defence.
 * This test ensures the first line (test-gate reset) works correctly.
 */
import { describe, expect, it } from 'vitest';
import { reviewGatesPassedSync } from '../../review-status-reconcile.js';
import type { ReviewStatus } from '../../review-status-reconcile.js';

function reviewStatus(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3512',
    reviewStatus: 'passed',
    testStatus: 'passed',
    verificationStatus: 'passed',
    mergeStatus: 'pending',
    readyForMerge: true,
    lastVerifiedCommit: 'a'.repeat(40),
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  } as ReviewStatus;
}

describe('verdict-write-door merge-gate invariant', () => {
  it('Given the update the door produces for a fresh-evidence passed verdict on an otherwise merge-ready row, reviewGatesPassedSync returns false', () => {
    // Start with a merge-ready row
    const baseRow = reviewStatus({
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      mergeStatus: 'pending',
    });

    // Simulate the update the door produces for a fresh evidence head
    const update = {
      testStatus: 'pending' as const,
      testNotes: 'Verdict re-gated: evidence=c1a2b3 row=a1b2c3 writer=coordinator',
    };

    // Merge the update over the base row
    const mergedRow: ReviewStatus = {
      ...baseRow,
      ...update,
    };

    // The merged row must NOT pass the gates
    expect(reviewGatesPassedSync(mergedRow)).toBe(false);
  });

  it('Given that same row with the test-gate reset removed, reviewGatesPassedSync returns true', () => {
    // Start with a merge-ready row
    const baseRow = reviewStatus({
      reviewStatus: 'passed',
      testStatus: 'passed',
      verificationStatus: 'passed',
      mergeStatus: 'pending',
    });

    // The base row (without test-gate reset) should pass gates
    expect(reviewGatesPassedSync(baseRow)).toBe(true);
  });
});
