import { describe, expect, it, vi } from 'vitest';

import { checkPostReviewCommits, evaluateReviewFreshness } from '../deacon-post-review-commits.js';
import { emptyPrFacts, type PrFacts } from '../pr-facts.js';

function openPr(headSha: string, overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    exists: true,
    open: true,
    url: 'https://github.com/o/r/pull/1',
    number: 1,
    headSha,
    ...overrides,
  };
}

describe('evaluateReviewFreshness (PAN-3917: the PR carries the reviewed commit)', () => {
  it('is unreviewed when the issue has no open PR', async () => {
    const result = await evaluateReviewFreshness('PAN-1', {
      getFacts: async () => emptyPrFacts('PAN-1'),
      getLatestReview: async () => { throw new Error('should not query reviews without a PR'); },
    });
    expect(result).toEqual({ kind: 'unreviewed' });
  });

  it('is unreviewed when no decisive review exists yet', async () => {
    const result = await evaluateReviewFreshness('PAN-1', {
      getFacts: async () => openPr('aaaa1111'),
      getLatestReview: async () => null,
    });
    expect(result).toEqual({ kind: 'unreviewed' });
  });

  it('is current when the review names the PR head', async () => {
    const result = await evaluateReviewFreshness('PAN-1', {
      getFacts: async () => openPr('aaaa1111'),
      getLatestReview: async () => ({ state: 'APPROVED', commitId: 'aaaa1111', submittedAt: null, author: 'r' }),
    });
    expect(result).toEqual({ kind: 'current', state: 'APPROVED', headSha: 'aaaa1111' });
  });

  it('is stale when commits landed after the review', async () => {
    const result = await evaluateReviewFreshness('PAN-1', {
      getFacts: async () => openPr('bbbb2222'),
      getLatestReview: async () => ({ state: 'CHANGES_REQUESTED', commitId: 'aaaa1111', submittedAt: null, author: 'r' }),
    });
    expect(result).toEqual({
      kind: 'stale', state: 'CHANGES_REQUESTED', reviewedSha: 'aaaa1111', headSha: 'bbbb2222',
    });
  });
});

describe('checkPostReviewCommits', () => {
  it('reports only the stale issues and writes nothing', async () => {
    const heads: Record<string, string> = { 'PAN-1': 'bbbb2222', 'PAN-2': 'cccc3333' };
    const getLatestReview = vi.fn(async (facts: PrFacts) => ({
      state: 'APPROVED',
      commitId: facts.issueId === 'PAN-1' ? 'aaaa1111' : 'cccc3333',
      submittedAt: null,
      author: 'r',
    }));

    const actions = await checkPostReviewCommits(['PAN-1', 'PAN-2'], {
      getFacts: async (issueId) => openPr(heads[issueId]!, { issueId }),
      getLatestReview,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-1');
    expect(actions[0]).toContain('aaaa1111');
    expect(actions[0]).toContain('bbbb2222');
  });

  it('swallows a forge failure for one issue without losing the others', async () => {
    const actions = await checkPostReviewCommits(['PAN-1', 'PAN-2'], {
      getFacts: async (issueId) => {
        if (issueId === 'PAN-1') throw new Error('gh exploded');
        return openPr('cccc3333', { issueId });
      },
      getLatestReview: async () => ({ state: 'APPROVED', commitId: 'aaaa1111', submittedAt: null, author: 'r' }),
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-2');
  });
});
