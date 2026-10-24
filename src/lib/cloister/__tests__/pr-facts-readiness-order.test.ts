/**
 * PAN-4540: a transient mergeability read is reported as itself, never as a
 * missing approval. The reviews that prove approval at the head are read only
 * for a green, mergeable PR, so on any other PR the approval is unproven.
 */
import { describe, expect, it } from 'vitest';

import { emptyPrFacts, evaluateMergeReadiness, type PrFacts } from '../pr-facts.js';

const HEAD = 'c'.repeat(40);
const GATE = { requireApprovalAtHead: true } as const;

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-4540'),
    forge: 'github',
    exists: true,
    open: true,
    headSha: HEAD,
    reviewDecision: 'APPROVED',
    approved: true,
    checks: 'green',
    mergeable: true,
    ...overrides,
  };
}

describe('evaluateMergeReadiness reason order (PAN-4540)', () => {
  it('an approved, green PR whose mergeability is not computed yet reports mergeability', () => {
    const result = evaluateMergeReadiness(facts({ mergeable: null, mergeableState: 'unknown' }), GATE);
    expect(result.ready).toBe(false);
    expect(result.reason).toBe('the forge has not computed mergeability yet (state=unknown)');
  });

  it('red checks are reported before an unproven approval', () => {
    expect(evaluateMergeReadiness(facts({ checks: 'red' }), GATE).reason).toBe(`CI checks failing on PR HEAD ${HEAD}`);
  });

  it('a green, mergeable PR still needs approval proven at its head', () => {
    expect(evaluateMergeReadiness(facts(), GATE).reason).toBe(`PR is not approved at PR HEAD ${HEAD} (needs a review approving that commit)`);
    expect(evaluateMergeReadiness(facts({ approvedAtHead: true }), GATE)).toEqual({ ready: true });
  });
});
