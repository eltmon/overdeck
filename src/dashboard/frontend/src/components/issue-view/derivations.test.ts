/**
 * PAN-5310: `isShipped`/`deriveShip` read the PR's own `merged` fact, so a
 * closed issue with a still-open PR is never reported as shipped, and the
 * ship model carries a `closed` status for a closed issue with no PR at all.
 */
import { describe, expect, it } from 'vitest';
import { deriveShip, isShipped } from './derivations';
import type { DerivedIssueState } from '../../types';

function derived(overrides: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return { issueId: 'PAN-1', state: 'closed', ...overrides };
}

const openPr = {
  url: 'https://example.test/pr/614', number: 614, reviewState: 'review-requested' as const,
  checks: 'pending' as const, mergeable: false,
};

const mergedPr = {
  url: 'https://example.test/pr/9', number: 9, reviewState: 'approved' as const,
  checks: 'green' as const, mergeable: true, merged: true,
};

describe('isShipped', () => {
  it('a closed issue with an open PR (no merged flag) is not shipped (ac1)', () => {
    expect(isShipped(derived({ pr: openPr }))).toBe(false);
  });

  it('a closed issue with pr.merged true is shipped (ac1)', () => {
    expect(isShipped(derived({ pr: mergedPr }))).toBe(true);
  });

  it('a closed issue with no PR is not shipped', () => {
    expect(isShipped(derived())).toBe(false);
  });

  it('a merged derived state is always shipped', () => {
    expect(isShipped(derived({ state: 'merged' }))).toBe(true);
  });
});

describe('deriveShip', () => {
  it('a closed issue with an open PR is pending, carries the PR, and blocks on the open PR (ac2)', () => {
    const ship = deriveShip(derived({ pr: openPr }));
    expect(ship.status).toBe('pending');
    expect(ship.prNumber).toBe(614);
    expect(ship.blockerReason).toBe('The issue is closed, but this pull request is still open — close or merge it');
  });

  it('a closed issue with no PR is closed with no prUrl (ac3)', () => {
    const ship = deriveShip(derived());
    expect(ship.status).toBe('closed');
    expect(ship.prUrl).toBeUndefined();
  });

  it('a closed issue with a merged PR is merged (ac3)', () => {
    const ship = deriveShip(derived({ pr: mergedPr }));
    expect(ship.status).toBe('merged');
  });
});
