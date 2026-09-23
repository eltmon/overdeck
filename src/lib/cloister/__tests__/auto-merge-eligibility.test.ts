import { describe, expect, it, vi } from 'vitest';

import {
  AUTO_MERGE_LABEL,
  BLOCKER_LABELS,
  HOLD_FOR_UAT_LABEL,
  autoMergeFromLabels,
  isAutoMergeEligible,
  issueHoldsForUat,
} from '../auto-merge-eligibility.js';
import { emptyPrFacts, type PrFacts } from '../pr-facts.js';

function readyFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-1486'),
    forge: 'github',
    exists: true,
    open: true,
    url: 'https://github.com/eltmon/overdeck/pull/1486',
    number: 1486,
    headSha: 'abc1234',
    headBranch: 'feature/pan-1486',
    reviewDecision: 'APPROVED',
    approved: true,
    mergeable: true,
    mergeableState: 'mergeable',
    checks: 'green',
    ...overrides,
  };
}

function deps(facts: PrFacts, labels: string[] = [], globalUat = false) {
  return {
    getFacts: vi.fn(async () => facts),
    getIssueLabels: vi.fn(async () => labels),
    getProjectDefault: vi.fn(() => undefined),
    isGlobalUatRequired: () => globalUat,
  };
}

describe('autoMergeFromLabels (PAN-3917: the toggle is a label, not a stored flag)', () => {
  it('reads auto-merge as true', () => {
    expect(autoMergeFromLabels([AUTO_MERGE_LABEL])).toBe(true);
  });
  it('reads hold-for-uat as false', () => {
    expect(autoMergeFromLabels([HOLD_FOR_UAT_LABEL])).toBe(false);
  });
  it('is undefined when neither label is present', () => {
    expect(autoMergeFromLabels(['in-review'])).toBeUndefined();
  });
});

describe('auto-merge eligibility', () => {
  it('exports blocker labels as a readonly tuple', () => {
    expect(BLOCKER_LABELS).toEqual(['needs-design', 'needs-discussion', 'do-not-merge']);
  });

  it('is eligible when the PR is approved, green, and mergeable', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts()))).resolves.toEqual({ eligible: true });
  });

  it('rejects an unapproved PR without looking at labels', async () => {
    const d = deps(readyFacts({ approved: false, reviewDecision: 'REVIEW_REQUIRED' }));
    await expect(isAutoMergeEligible('PAN-1486', d))
      .resolves.toEqual({ eligible: false, reason: 'PR is not approved' });
    expect(d.getIssueLabels).not.toHaveBeenCalled();
  });

  it('rejects a PR whose latest review requested changes', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({
      approved: false, changesRequested: true, reviewDecision: 'CHANGES_REQUESTED',
    })))).resolves.toEqual({ eligible: false, reason: 'latest review requested changes' });
  });

  it('rejects failing checks and pending checks by name', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({ checks: 'red' }))))
      .resolves.toEqual({ eligible: false, reason: 'CI checks failing on PR HEAD abc1234' });
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({ checks: 'pending' }))))
      .resolves.toEqual({ eligible: false, reason: 'CI checks still pending on PR HEAD abc1234' });
  });

  it('rejects a draft, a closed PR, and an already-merged PR', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({ draft: true }))))
      .resolves.toEqual({ eligible: false, reason: 'PR is a draft' });
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({ open: false, closed: true }))))
      .resolves.toEqual({ eligible: false, reason: 'PR is closed' });
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({ open: false, merged: true }))))
      .resolves.toEqual({ eligible: false, reason: 'PR is already merged' });
  });

  it('rejects an unmergeable PR with the forge state in the reason', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts({ mergeable: false, mergeableState: 'conflicting' }))))
      .resolves.toEqual({ eligible: false, reason: 'PR is not mergeable (state=conflicting)' });
  });

  it('holds when the issue has no PR at all', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(emptyPrFacts('PAN-1486'))))
      .resolves.toEqual({ eligible: false, reason: 'no pull request for this issue' });
  });

  it('holds when the forge lookup itself failed', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(emptyPrFacts('PAN-1486', 'gh pr view failed: boom'))))
      .resolves.toEqual({ eligible: false, reason: 'gh pr view failed: boom' });
  });

  it.each(BLOCKER_LABELS)('rejects issues carrying the %s label', async (label) => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts(), [label])))
      .resolves.toEqual({ eligible: false, reason: `issue carries blocker label: ${label}` });
  });

  it('holds for UAT when the issue carries hold-for-uat', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts(), [HOLD_FOR_UAT_LABEL])))
      .resolves.toEqual({ eligible: false, reason: 'held for UAT (auto-merge toggled off)' });
  });

  it('holds for UAT when the global flag is on and the issue is silent', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts(), [], true)))
      .resolves.toEqual({ eligible: false, reason: 'held for UAT (auto-merge toggled off)' });
  });

  it('auto-merge on the issue overrides the global UAT hold', async () => {
    await expect(isAutoMergeEligible('PAN-1486', deps(readyFacts(), [AUTO_MERGE_LABEL], true)))
      .resolves.toEqual({ eligible: true });
  });

  it('the per-project default decides when the issue is silent', async () => {
    const d = { ...deps(readyFacts(), [], false), getProjectDefault: vi.fn(() => 'hold' as const) };
    await expect(isAutoMergeEligible('PAN-1486', d))
      .resolves.toEqual({ eligible: false, reason: 'held for UAT (auto-merge toggled off)' });
  });

  it('accepts a mergeable, approved GitLab MR', async () => {
    const facts = readyFacts({
      issueId: 'MIN-831',
      forge: 'gitlab',
      url: 'https://gitlab.com/eltmon/mind-your-now/-/merge_requests/62',
      number: 62,
    });
    await expect(isAutoMergeEligible('MIN-831', deps(facts))).resolves.toEqual({ eligible: true });
  });
});

describe('issueHoldsForUat (review of #3993: the per-issue tier the merge train must honor)', () => {
  it('a hold-for-uat label holds an issue in an auto project', async () => {
    await expect(issueHoldsForUat('PAN-1', { auto_merge_default: 'auto' }, false, {
      getIssueLabels: async () => [HOLD_FOR_UAT_LABEL],
    })).resolves.toBe(true);
  });

  it('an auto-merge label releases an issue in a held project', async () => {
    await expect(issueHoldsForUat('PAN-1', { auto_merge_default: 'hold' }, true, {
      getIssueLabels: async () => [AUTO_MERGE_LABEL],
    })).resolves.toBe(false);
  });

  it('with no label, follows the project default, then the global flag', async () => {
    const noLabels = { getIssueLabels: async () => [] };
    await expect(issueHoldsForUat('PAN-1', { auto_merge_default: 'hold' }, false, noLabels)).resolves.toBe(true);
    await expect(issueHoldsForUat('PAN-1', {}, true, noLabels)).resolves.toBe(true);
    await expect(issueHoldsForUat('PAN-1', {}, false, noLabels)).resolves.toBe(false);
  });

  it('a label read failure falls back to the project and global tiers', async () => {
    const failing = { getIssueLabels: async () => { throw new Error('gh: rate limited'); } };
    await expect(issueHoldsForUat('PAN-1', { auto_merge_default: 'hold' }, false, failing)).resolves.toBe(true);
    await expect(issueHoldsForUat('PAN-1', { auto_merge_default: 'auto' }, true, failing)).resolves.toBe(false);
  });
});
