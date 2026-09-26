/**
 * #4066 review: the merge gate's approval answers, per head, that the board's
 * derived `ready` reads instead of the forge's `reviewDecision`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approvalProvenAtHead,
  cachedApprovalAtHead,
  onApprovalAtHeadChanged,
  recordApprovalAtHead,
  recordReadApprovalAtHead,
  resetApprovalAtHeadCache,
} from '../approval-at-head.js';
import { emptyPrFacts, evaluateMergeReadiness, type PrFacts } from '../pr-facts.js';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    exists: true,
    open: true,
    headSha: HEAD,
    approved: true,
    approvedAtHead: true,
    checks: 'green',
    mergeable: true,
    ...overrides,
  };
}

afterEach(() => {
  resetApprovalAtHeadCache();
  vi.useRealTimers();
});

describe('approvalProvenAtHead', () => {
  it('is the approval half of the merge gate', () => {
    expect(approvalProvenAtHead(facts())).toBe(true);
    // A reviewDecision APPROVED the gate never proved at this head.
    expect(approvalProvenAtHead(facts({ approvedAtHead: undefined }))).toBe(false);
    expect(approvalProvenAtHead(facts({ changesRequested: true }))).toBe(false);
    expect(approvalProvenAtHead(facts({ forge: 'gitlab', approvedAtHead: undefined }))).toBe(true);
    expect(approvalProvenAtHead(facts({ forge: 'gitlab', approved: false }))).toBe(false);
  });

  it('agrees with evaluateMergeReadiness under the gate policy', () => {
    for (const variant of [facts(), facts({ approvedAtHead: undefined }), facts({ forge: 'gitlab', approved: false })]) {
      expect(evaluateMergeReadiness(variant, { requireApprovalAtHead: true }).ready).toBe(approvalProvenAtHead(variant));
    }
  });
});

describe('cachedApprovalAtHead', () => {
  it('answers for the head the gate judged, and nothing else', () => {
    recordApprovalAtHead(facts());
    expect(cachedApprovalAtHead('pan-1', HEAD)).toBe(true);
    expect(cachedApprovalAtHead('PAN-1', HEAD.slice(0, 12))).toBe(true);
    expect(cachedApprovalAtHead('PAN-1', OTHER)).toBeUndefined();
    expect(cachedApprovalAtHead('PAN-2', HEAD)).toBeUndefined();
    expect(cachedApprovalAtHead('PAN-1', null)).toBeUndefined();
  });

  it('records a refusal as false, and never records a failed read', () => {
    recordApprovalAtHead(facts({ approvedAtHead: undefined }));
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBe(false);
    resetApprovalAtHeadCache();
    recordApprovalAtHead(facts({ error: 'gh: rate limited' }));
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBeUndefined();
  });

  it('expires, so a stale answer never derives ready', () => {
    vi.useFakeTimers();
    recordApprovalAtHead(facts());
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBeUndefined();
  });

  it("takes a read's marker proof at the head, but never a read's refusal", () => {
    recordReadApprovalAtHead(facts());
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBe(true);
    resetApprovalAtHeadCache();
    recordReadApprovalAtHead(facts({ approvedAtHead: undefined }));
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBeUndefined();
  });

  it("prefers the gate's own answer over a read's proof", () => {
    recordReadApprovalAtHead(facts());
    recordApprovalAtHead(facts({ changesRequested: true }));
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBe(false);
  });
});

describe('onApprovalAtHeadChanged', () => {
  it('fires when the answer or the head changes, not on a repeat', () => {
    const listener = vi.fn();
    const unsubscribe = onApprovalAtHeadChanged(listener);
    recordApprovalAtHead(facts());
    recordApprovalAtHead(facts());
    recordApprovalAtHead(facts({ headSha: OTHER }));
    recordApprovalAtHead(facts({ headSha: OTHER, approvedAtHead: undefined }));
    unsubscribe();
    recordApprovalAtHead(facts());
    expect(listener.mock.calls).toEqual([['PAN-1'], ['PAN-1'], ['PAN-1']]);
  });

  it('fires when the same answer replaces an expired one', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = onApprovalAtHeadChanged(listener);
    recordApprovalAtHead(facts());
    vi.advanceTimersByTime(5 * 60_000 + 1);
    // The expired answer read as unknown; the same answer restores it.
    recordApprovalAtHead(facts());
    unsubscribe();
    expect(listener.mock.calls).toEqual([['PAN-1'], ['PAN-1']]);
    expect(cachedApprovalAtHead('PAN-1', HEAD)).toBe(true);
  });

  it("fires when a read's proof is added or replaces an expired one, not on a repeat or a refusal", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const unsubscribe = onApprovalAtHeadChanged(listener);
    recordReadApprovalAtHead(facts({ approvedAtHead: undefined }));
    expect(listener).not.toHaveBeenCalled();
    recordReadApprovalAtHead(facts());
    recordReadApprovalAtHead(facts());
    vi.advanceTimersByTime(60_000 + 1);
    recordReadApprovalAtHead(facts());
    recordReadApprovalAtHead(facts({ headSha: OTHER }));
    unsubscribe();
    expect(listener.mock.calls).toEqual([['PAN-1'], ['PAN-1'], ['PAN-1']]);
  });
});
