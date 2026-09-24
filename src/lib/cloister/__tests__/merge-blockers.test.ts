import { describe, it, expect } from 'vitest';

import { blockerReasonsFor, getMergeBlockersPayload } from '../merge-blockers.js';
import { emptyPrFacts, type PrFacts } from '../pr-facts.js';

function facts(overrides: Partial<PrFacts>): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    exists: true,
    open: true,
    url: 'https://github.com/o/r/pull/1',
    number: 1,
    approved: true,
    reviewDecision: 'APPROVED',
    mergeable: true,
    checks: 'green',
    headSha: 'abcdef1234',
    ...overrides,
  };
}

function signals(issueId: string, hasOpenPr = true) {
  return {
    issueId,
    issueOpen: true,
    hasOpenPr,
    hasMergedPr: false,
    hasConventionBranch: true,
    branchUnmerged: true,
    hasMergedBranchWork: false,
    phaseLabel: 'in-review',
    hasXbriefSpec: true,
    explicitlyReady: false,
    hasTerminalCloseOut: false,
  };
}

const project = { key: 'p', config: { name: 'p', path: '/tmp/p' } } as never;

describe('blockerReasonsFor (PAN-3917: forge-native blockers, no stored row)', () => {
  it('reports nothing for an approved, green, mergeable PR', () => {
    expect(blockerReasonsFor(facts({}))).toEqual([]);
  });

  it('reports a merge conflict when the forge says the branch conflicts', () => {
    expect(blockerReasonsFor(facts({ mergeable: false, mergeableState: 'conflicting' }))).toEqual([
      { type: 'merge_conflict', summary: 'the branch conflicts with the base branch' },
    ]);
  });

  it('reports not_mergeable for a non-conflict unmergeable state', () => {
    expect(blockerReasonsFor(facts({ mergeable: false, mergeableState: 'blocked' }))).toEqual([
      { type: 'not_mergeable', summary: 'the forge reports the PR is not mergeable (blocked)' },
    ]);
  });

  it('reports failing checks from the check rollup', () => {
    expect(blockerReasonsFor(facts({ checks: 'red' }))).toEqual([
      { type: 'failing_checks', summary: 'CI checks are failing on abcdef12' },
    ]);
  });

  it('reports both when the PR is red and unmergeable', () => {
    const reasons = blockerReasonsFor(facts({ checks: 'red', mergeable: false, mergeableState: 'conflicting' }));
    expect(reasons.map((r) => r.type)).toEqual(['merge_conflict', 'failing_checks']);
  });

  it('reports nothing once the PR is merged', () => {
    expect(blockerReasonsFor(facts({ merged: true, open: false, checks: 'red' }))).toEqual([]);
  });
});

describe('getMergeBlockersPayload', () => {
  const deps = (factsById: Record<string, PrFacts>, ids: string[]) => ({
    listProjects: async () => [project],
    gather: async () => [{ project: project.config, signals: ids.map((id) => signals(id)) }] as never,
    getFacts: async (issueId: string) => factsById[issueId] ?? emptyPrFacts(issueId),
  });

  it('returns only approved PRs the forge is blocking', async () => {
    const payload = await getMergeBlockersPayload(deps({
      'PAN-1': facts({ issueId: 'PAN-1', mergeable: false, mergeableState: 'conflicting' }),
      'PAN-2': facts({ issueId: 'PAN-2' }),
      'PAN-3': facts({ issueId: 'PAN-3', approved: false, reviewDecision: 'REVIEW_REQUIRED', checks: 'red' }),
    }, ['PAN-1', 'PAN-2', 'PAN-3']));

    expect(payload).toEqual([
      {
        issueId: 'PAN-1',
        prUrl: 'https://github.com/o/r/pull/1',
        reasons: [{ type: 'merge_conflict', summary: 'the branch conflicts with the base branch' }],
      },
    ]);
  });

  it('returns empty when nothing is blocked', async () => {
    expect(await getMergeBlockersPayload(deps({ 'PAN-2': facts({ issueId: 'PAN-2' }) }, ['PAN-2']))).toEqual([]);
  });

  it('skips issues with no open PR', async () => {
    const payload = await getMergeBlockersPayload({
      listProjects: async () => [project],
      gather: async () => [{ project: project.config, signals: [signals('PAN-7', false)] }] as never,
      getFacts: async () => { throw new Error('should not look up a PR-less issue'); },
    });
    expect(payload).toEqual([]);
  });
});
