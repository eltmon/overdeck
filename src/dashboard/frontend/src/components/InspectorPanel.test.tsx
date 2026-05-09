/**
 * Tests for PAN-366: Review & Test button state logic in InspectorPanel.
 *
 * Tests the exported getReviewButtonState() helper for all relevant
 * queuePosition / reviewStatus / testStatus combinations.
 */

import { describe, it, expect, vi } from 'vitest';
import { getReviewButtonState } from './InspectorPanel';
import { shouldForceReviewTrigger } from './inspector/utils';

describe('getReviewButtonState', () => {
  // ---------------------------------------------------------------------------
  // Active (position === 0 or status === reviewing/testing)
  // ---------------------------------------------------------------------------

  it('shows "Reviewing..." and is disabled+spinning when queuePosition === 0 and specialist is review', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'reviewing', testStatus: 'pending', queuePosition: 0, activeSpecialist: 'review', readyForMerge: false },
      false
    );
    expect(state.label).toBe('Reviewing...');
    expect(state.disabled).toBe(true);
    expect(state.spinning).toBe(true);
  });

  it('shows "Testing..." when activeSpecialist is test', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'testing', queuePosition: 0, activeSpecialist: 'test', readyForMerge: false },
      false
    );
    expect(state.label).toBe('Testing...');
    expect(state.disabled).toBe(true);
    expect(state.spinning).toBe(true);
  });

  it('shows "Testing..." when testStatus is "testing" (legacy path without queuePosition)', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'pending', testStatus: 'testing', queuePosition: undefined, activeSpecialist: null, readyForMerge: false },
      false
    );
    expect(state.label).toBe('Testing...');
    expect(state.disabled).toBe(true);
    expect(state.spinning).toBe(true);
  });

  it('shows "Reviewing..." when reviewStatus is "reviewing" (legacy path)', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'reviewing', testStatus: 'pending', queuePosition: undefined, activeSpecialist: null, readyForMerge: false },
      false
    );
    expect(state.label).toBe('Reviewing...');
    expect(state.disabled).toBe(true);
    expect(state.spinning).toBe(true);
  });

  it('is disabled and spinning when mutation is pending', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'pending', testStatus: 'pending', queuePosition: null, activeSpecialist: null, readyForMerge: false },
      true // mutation pending
    );
    expect(state.disabled).toBe(true);
    expect(state.spinning).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Queued in merge queue (position >= 1, activeSpecialist === 'merge')
  // ---------------------------------------------------------------------------

  it('shows "Queued" for position 1 in merge queue', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', queuePosition: 1, activeSpecialist: 'merge', readyForMerge: true },
      false
    );
    expect(state.label).toBe('Queued');
    expect(state.disabled).toBe(true);
    expect(state.spinning).toBe(false);
  });

  it('shows "Queued (2nd)" for position 2 in merge queue', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', queuePosition: 2, activeSpecialist: 'merge', readyForMerge: true },
      false
    );
    expect(state.label).toBe('Queued (2nd)');
  });

  it('shows "Queued (3rd)" for position 3 in merge queue', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', queuePosition: 3, activeSpecialist: 'merge', readyForMerge: true },
      false
    );
    expect(state.label).toBe('Queued (3rd)');
  });

  it('shows "Queued (4th)" for position 4 in merge queue', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', queuePosition: 4, activeSpecialist: 'merge', readyForMerge: true },
      false
    );
    expect(state.label).toBe('Queued (4th)');
  });

  it('shows "Queued (11th)" for position 11 in merge queue (teens exception)', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', queuePosition: 11, activeSpecialist: 'merge', readyForMerge: true },
      false
    );
    expect(state.label).toBe('Queued (11th)');
  });

  it('shows "Queued (21st)" for position 21 in merge queue', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', queuePosition: 21, activeSpecialist: 'merge', readyForMerge: true },
      false
    );
    expect(state.label).toBe('Queued (21st)');
  });

  // ---------------------------------------------------------------------------
  // Normal (not queued, not active)
  // ---------------------------------------------------------------------------

  it('shows "Review & Test" when idle and not ready for merge', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'pending', testStatus: 'pending', queuePosition: null, activeSpecialist: null, readyForMerge: false },
      false
    );
    expect(state.label).toBe('Review & Test');
    expect(state.disabled).toBe(false);
    expect(state.spinning).toBe(false);
  });

  it('shows "Re-Review" when readyForMerge is true', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'pending', queuePosition: null, activeSpecialist: null, readyForMerge: true },
      false
    );
    expect(state.label).toBe('Re-Review');
    expect(state.disabled).toBe(false);
  });

  it('shows "Re-Review" when review and test passed but merge previously failed', () => {
    const state = getReviewButtonState(
      { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'failed', queuePosition: null, activeSpecialist: null, readyForMerge: false },
      false
    );
    expect(state.label).toBe('Re-Review');
    expect(state.disabled).toBe(false);
  });

  it('shows "Review & Test" when reviewStatus is undefined', () => {
    const state = getReviewButtonState(undefined, false);
    expect(state.label).toBe('Review & Test');
    expect(state.disabled).toBe(false);
    expect(state.spinning).toBe(false);
  });

  it('shows "Re-request Review" for a stranded pending review', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-09T03:00:00Z'));
      const state = getReviewButtonState(
        {
          reviewStatus: 'pending',
          testStatus: 'pending',
          queuePosition: null,
          activeSpecialist: null,
          readyForMerge: false,
          reviewSpawnedAt: '2026-05-09T01:59:59Z',
          updatedAt: '2026-05-09T02:30:00Z',
        },
        false
      );
      expect(state.label).toBe('Re-request Review');
      expect(state.disabled).toBe(false);
      expect(state.spinning).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shouldForceReviewTrigger', () => {
  it('forces rerun after a failed review', () => {
    expect(shouldForceReviewTrigger({
      reviewStatus: 'failed',
      testStatus: 'pending',
      readyForMerge: false,
    })).toBe(true);
  });

  it('forces rerun after verification failure', () => {
    expect(shouldForceReviewTrigger({
      reviewStatus: 'pending',
      testStatus: 'pending',
      verificationStatus: 'failed',
      readyForMerge: false,
    })).toBe(true);
  });

  it('does not force rerun for a brand-new pending review', () => {
    expect(shouldForceReviewTrigger({
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
    })).toBe(false);
  });

  it('forces rerun for a pending review stranded beyond two specialist timeouts', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-09T03:00:00Z'));
      expect(shouldForceReviewTrigger({
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        reviewSpawnedAt: '2026-05-09T01:59:59Z',
      })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not force rerun for a pending review inside the timeout window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-09T03:00:00Z'));
      expect(shouldForceReviewTrigger({
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        reviewSpawnedAt: '2026-05-09T02:10:00Z',
      })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
