import { describe, expect, it } from 'vitest';

import { evaluateMergeReadiness, type PrFacts } from '../../../../src/lib/cloister/pr-facts.js';
import { getMergeReadyIssues } from '../../../../src/lib/cloister/merge-ready-set.js';

/**
 * PAN-3917 FR-9: the ready set is a POSITIVE test — approved, checks green,
 * forge-mergeable. `checks: 'none'` (the head commit reported no checks) and
 * `mergeable: null` (the forge has not computed it yet) are missing evidence,
 * and missing evidence is not readiness.
 */
function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId: 'PAN-1',
    forge: 'github',
    url: 'https://github.com/eltmon/overdeck/pull/1',
    number: 1,
    exists: true,
    open: true,
    merged: false,
    closed: false,
    draft: false,
    headSha: 'abc1234',
    headBranch: 'feature/pan-1',
    reviewDecision: 'APPROVED',
    approved: true,
    changesRequested: false,
    mergeable: true,
    mergeableState: 'clean',
    checks: 'green',
    ...overrides,
  };
}

describe('evaluateMergeReadiness', () => {
  it('is ready only when the checks are green and the forge says mergeable', () => {
    expect(evaluateMergeReadiness(facts())).toEqual({ ready: true });
  });

  it('is not ready when the head commit reported no checks at all', () => {
    const verdict = evaluateMergeReadiness(facts({ checks: 'none' }));
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain('no CI checks reported');
  });

  it('is not ready when the forge has not computed mergeability yet', () => {
    const verdict = evaluateMergeReadiness(facts({ mergeable: null, mergeableState: null }));
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain('not computed mergeability');
  });

  it('still blocks red checks and an explicit not-mergeable', () => {
    expect(evaluateMergeReadiness(facts({ checks: 'red' })).ready).toBe(false);
    expect(evaluateMergeReadiness(facts({ checks: 'pending' })).ready).toBe(false);
    expect(evaluateMergeReadiness(facts({ mergeable: false })).ready).toBe(false);
  });
});

describe('getMergeReadyIssues', () => {
  it('admits only the issues whose facts pass every positive test', async () => {
    const byIssue: Record<string, PrFacts> = {
      'PAN-1': facts({ issueId: 'PAN-1' }),
      'PAN-2': facts({ issueId: 'PAN-2', checks: 'none' }),
      'PAN-3': facts({ issueId: 'PAN-3', mergeable: null }),
    };
    const ready = await getMergeReadyIssues({
      listProjects: async () => [],
      gather: async () => [
        {
          project: { key: 'overdeck' },
          signals: Object.keys(byIssue).map((issueId) => ({ issueId, hasOpenPr: true, issueOpen: true, phaseLabel: null })),
        },
      ] as never,
      getFacts: async (issueId) => byIssue[issueId]!,
    });

    expect(ready).toEqual(['PAN-1']);
  });
});
