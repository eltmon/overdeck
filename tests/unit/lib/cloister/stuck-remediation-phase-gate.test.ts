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

// ── PAN-2581 FR-2 (residual): the health-check poke loop's phase gate ─────────
import { shouldSkipIdlePokeForAgent } from '../../../../src/lib/cloister/stuck-remediation.js';

describe('shouldSkipIdlePokeForAgent — health-check poke phase gate (PAN-2581 FR-2)', () => {
  it('skips a work agent while its issue is in review', () => {
    expect(shouldSkipIdlePokeForAgent('work', status({ reviewStatus: 'reviewing' }))).toBe(true);
  });

  it('skips a warm-idle review agent after its verdict (passed)', () => {
    expect(shouldSkipIdlePokeForAgent('review', status({ reviewStatus: 'passed' }))).toBe(true);
  });

  it('skips a work agent with an un-serviced durable review request', () => {
    expect(shouldSkipIdlePokeForAgent('work', status({ reviewStatus: 'pending', reviewRequestedAt: '2026-07-12T00:01:00.000Z' }))).toBe(true);
  });

  it('skips owed-rework agents too — the PAN-2519 wedge path owns their escalation', () => {
    expect(shouldSkipIdlePokeForAgent('work', status({ reviewStatus: 'blocked' }))).toBe(true);
  });

  it('does NOT skip a work agent mid-build (no review activity yet)', () => {
    expect(shouldSkipIdlePokeForAgent('work', status({}))).toBe(false);
  });

  it('does NOT skip a work agent with no review record at all', () => {
    expect(shouldSkipIdlePokeForAgent('work', null)).toBe(false);
  });

  it('never gates roles outside work/review/test', () => {
    expect(shouldSkipIdlePokeForAgent('plan', status({ reviewStatus: 'reviewing' }))).toBe(false);
    expect(shouldSkipIdlePokeForAgent('flywheel', status({ reviewStatus: 'reviewing' }))).toBe(false);
    expect(shouldSkipIdlePokeForAgent(undefined, status({ reviewStatus: 'reviewing' }))).toBe(false);
  });
});
