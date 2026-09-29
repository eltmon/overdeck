/**
 * PAN-4384: the merge-ready-but-conflicting predicate and the head-bound
 * approval read, judged from injected forge facts and GitHub reviews.
 */
import { describe, expect, it, vi } from 'vitest';

import { evaluateConflictRepairGate, readApprovalStandsAtHead } from '../merge-gate.js';
import { emptyPrFacts, type GitHubReviewsAtHead, type PrFacts } from '../pr-facts.js';

const HEAD = 'dddd444400000000000000000000000000000000';
const OLD = 'aaaa111100000000000000000000000000000000';

function conflictingFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    url: 'https://github.com/eltmon/overdeck/pull/4317',
    number: 4317,
    exists: true,
    open: true,
    headSha: HEAD,
    headBranch: 'feature/pan-1',
    reviewDecision: 'APPROVED',
    approved: true,
    approvedAtHead: true,
    mergeable: false,
    mergeableState: 'dirty',
    checks: 'green',
    testChecks: 'green',
    testJobSucceeded: true,
    ...overrides,
  };
}

function reviewOf(commit: string): GitHubReviewsAtHead {
  return {
    headRefOid: HEAD,
    reviews: [{ state: 'APPROVED', author: { login: 'eltmon' }, authorAssociation: 'OWNER', commit: { oid: commit } }],
  };
}

function gateDeps(facts: PrFacts, reviews: GitHubReviewsAtHead = reviewOf(OLD)) {
  const readReviews = vi.fn(async () => reviews);
  return {
    readReviews,
    deps: {
      getFacts: async () => facts,
      readReviews,
      overdeckLogins: async () => ['overdeck-agent[bot]'],
      ciTestsRequired: () => true,
      uatRequired: async () => true,
    },
  };
}

describe('evaluateConflictRepairGate', () => {
  it('is conflicting for an open PR approved at its head, green, and not mergeable', async () => {
    const { deps, readReviews } = gateDeps(conflictingFacts());
    const result = await evaluateConflictRepairGate('PAN-1', deps);
    expect(result.conflicting).toBe(true);
    expect(result.facts.headSha).toBe(HEAD);
    expect(readReviews).not.toHaveBeenCalled();
  });

  it('proves approval at head from a GitHub review read directly when no marker names the head', async () => {
    const { deps, readReviews } = gateDeps(conflictingFacts({ approvedAtHead: undefined }), reviewOf(HEAD));
    const result = await evaluateConflictRepairGate('PAN-1', deps);
    expect(result.conflicting).toBe(true);
    expect(readReviews).toHaveBeenCalledWith('eltmon/overdeck', 4317);
  });

  it('is not conflicting when the forge says mergeable', async () => {
    const { deps } = gateDeps(conflictingFacts({ mergeable: true }));
    expect((await evaluateConflictRepairGate('PAN-1', deps)).conflicting).toBe(false);
  });

  it('is not conflicting while the forge has not computed mergeability', async () => {
    const { deps } = gateDeps(conflictingFacts({ mergeable: null }));
    expect((await evaluateConflictRepairGate('PAN-1', deps)).conflicting).toBe(false);
  });

  it.each(['red', 'pending', 'none'] as const)('is not conflicting when checks are %s', async (checks) => {
    const { deps } = gateDeps(conflictingFacts({ checks }));
    const result = await evaluateConflictRepairGate('PAN-1', deps);
    expect(result.conflicting).toBe(false);
    expect(result.reason).toBe('PR is not otherwise merge-ready');
  });

  it('is not conflicting when changes are requested', async () => {
    const { deps } = gateDeps(conflictingFacts({ changesRequested: true }));
    expect((await evaluateConflictRepairGate('PAN-1', deps)).conflicting).toBe(false);
  });

  it('is not conflicting when the only approving review names an older commit', async () => {
    const { deps, readReviews } = gateDeps(conflictingFacts({ approvedAtHead: undefined }), reviewOf(OLD));
    const result = await evaluateConflictRepairGate('PAN-1', deps);
    expect(result.conflicting).toBe(false);
    expect(result.reason).toContain('not approved at PR HEAD');
    expect(readReviews).toHaveBeenCalled();
  });

  it('applies the CI test-job policy of the merge gate', async () => {
    const { deps } = gateDeps(conflictingFacts({ testChecks: 'none', testJobSucceeded: false }));
    const result = await evaluateConflictRepairGate('PAN-1', deps);
    expect(result.conflicting).toBe(false);
    expect(result.reason).toContain('no CI test job reported');
  });

  it('holds a failed UAT at the head when UAT is required', async () => {
    const { deps } = gateDeps(conflictingFacts({ uatVerdict: { status: 'failed', sha: HEAD, postedAt: null } }));
    expect((await evaluateConflictRepairGate('PAN-1', deps)).conflicting).toBe(false);
  });

  it('is not conflicting when the forge read failed', async () => {
    const { deps } = gateDeps({ ...emptyPrFacts('PAN-1', 'gh failed'), mergeable: false });
    const result = await evaluateConflictRepairGate('PAN-1', deps);
    expect(result).toEqual(expect.objectContaining({ conflicting: false, reason: 'gh failed' }));
  });
});

describe('readApprovalStandsAtHead', () => {
  it('is true for a verdict marker at the head', async () => {
    const { deps, readReviews } = gateDeps(conflictingFacts({ mergeable: true }));
    expect(await readApprovalStandsAtHead('PAN-1', deps)).toBe(true);
    expect(readReviews).not.toHaveBeenCalled();
  });

  it('is true for a GitHub review of the head', async () => {
    const { deps } = gateDeps(conflictingFacts({ approvedAtHead: undefined, mergeable: true }), reviewOf(HEAD));
    expect(await readApprovalStandsAtHead('PAN-1', deps)).toBe(true);
  });

  it('is false when the approving review names an older commit', async () => {
    const { deps } = gateDeps(conflictingFacts({ approvedAtHead: undefined, mergeable: true }), reviewOf(OLD));
    expect(await readApprovalStandsAtHead('PAN-1', deps)).toBe(false);
  });

  it('is undefined when the facts carry an error', async () => {
    const { deps } = gateDeps(emptyPrFacts('PAN-1', 'gh failed'));
    expect(await readApprovalStandsAtHead('PAN-1', deps)).toBeUndefined();
  });

  it('is undefined for a GitLab MR without a marker', async () => {
    const { deps } = gateDeps(conflictingFacts({ forge: 'gitlab', approvedAtHead: undefined }));
    expect(await readApprovalStandsAtHead('PAN-1', deps)).toBeUndefined();
  });
});
