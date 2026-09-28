/**
 * PAN-4291 Work Item 4: priceGhListCall prices a `gh pr/issue list` call by
 * the REST pages it actually walks, instead of a flat 1 point.
 */

import { describe, expect, it } from 'vitest';

import { priceGhListCall } from '../../../../src/lib/github-quota/gh-cost.js';

const PR_CACHE_FIELDS = 'number,url,title,state,mergedAt,mergeable,headRefName,headRefOid,baseRefName,isDraft,reviewDecision,reviewRequests,statusCheckRollup,updatedAt,closedAt,author';

function rows(n: number): string {
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i })));
}

describe('priceGhListCall (PAN-4291)', () => {
  it('prices the pr-cache args at 6 for a full 200-row response, and 3 for a short 20-row response (AC1)', () => {
    const args = ['pr', 'list', '--state', 'all', '--limit', '200', '--json', PR_CACHE_FIELDS];
    expect(priceGhListCall(args, rows(200))).toBe(6);
    expect(priceGhListCall(args, rows(20))).toBe(3);
  });

  it('scales with --limit for the same --json fields (AC2)', () => {
    const base = ['pr', 'list', '--json', 'reviewRequests,statusCheckRollup'];
    expect(priceGhListCall([...base, '--limit', '100'])).toBe(3);
    expect(priceGhListCall([...base, '--limit', '50'])).toBe(2);
    expect(priceGhListCall([...base, '--limit', '30'])).toBe(1);
  });

  it('prices the close-out merged-PR lookup at 1, and returns null for non-list calls (AC3)', () => {
    expect(priceGhListCall(['pr', 'list', '--head', 'feature/x', '--state', 'merged', '--json', 'headRefOid,mergeCommit', '--limit', '1'])).toBe(1);
    expect(priceGhListCall(['api', 'rate_limit'])).toBeNull();
    expect(priceGhListCall(['pr', 'view', '1'])).toBeNull();
  });

  it('defaults --limit to 30 when absent', () => {
    expect(priceGhListCall(['issue', 'list', '--json', 'number'])).toBe(1);
  });

  it('accepts -L and --limit=N forms', () => {
    const base = ['pr', 'list', '--json', 'reviewRequests,statusCheckRollup'];
    expect(priceGhListCall([...base, '-L', '100'])).toBe(3);
    expect(priceGhListCall([...base, '--limit=100'])).toBe(3);
  });

  it('falls back to the full page set when stdout is missing or not a JSON array', () => {
    const args = ['pr', 'list', '--json', 'reviewRequests,statusCheckRollup', '--limit', '100'];
    expect(priceGhListCall(args)).toBe(3);
    expect(priceGhListCall(args, 'not json')).toBe(3);
    expect(priceGhListCall(args, '{"not":"an array"}')).toBe(3);
  });
});
