import { describe, expect, it } from 'vitest';

import { blockerReasonsFor } from '../merge-blocker-types.js';
import type { PrFacts } from '../pr-facts.js';

function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId: 'PAN-1', forge: 'github', url: 'https://github.com/o/r/pull/1', number: 1,
    exists: true, open: true, merged: false, closed: false, draft: false,
    headSha: 'abcdef1234', headBranch: 'feature/pan-1', reviewDecision: 'APPROVED', approved: true,
    changesRequested: false, mergeable: true, mergeableState: 'mergeable', checks: 'green', testChecks: 'green',
    ...overrides,
  };
}

const types = (f: PrFacts, extras?: Parameters<typeof blockerReasonsFor>[1]) => blockerReasonsFor(f, extras).map((r) => r.type);

describe('blockerReasonsFor (PAN-4753 WI-7: six types)', () => {
  it('returns nothing for a clean PR', () => {
    expect(blockerReasonsFor(facts(), {})).toEqual([]);
  });

  it('reports failing checks', () => {
    expect(blockerReasonsFor(facts({ checks: 'red' }), {})).toEqual([
      { type: 'failing_checks', summary: 'CI checks are failing on abcdef12' },
    ]);
  });

  it('reports a merge conflict and a not-mergeable state', () => {
    expect(types(facts({ mergeable: false, mergeableState: 'conflicting' }), {})).toEqual(['merge_conflict']);
    expect(blockerReasonsFor(facts({ mergeable: false, mergeableState: 'blocked' }), {})).toEqual([
      { type: 'not_mergeable', summary: 'the forge reports the PR is not mergeable (blocked)' },
    ]);
  });

  it('reports a draft, requested changes and open threads only with extras', () => {
    const f = facts({ draft: true, changesRequested: true, approved: false });
    expect(blockerReasonsFor(f, { unresolvedThreads: 2 })).toEqual([
      { type: 'draft_pr', summary: 'the PR is a draft' },
      { type: 'changes_requested', summary: 'the latest review requested changes' },
      { type: 'unresolved_conversations', summary: '2 unresolved review threads' },
    ]);
    expect(blockerReasonsFor(facts(), { unresolvedThreads: 1 })[0]!.summary).toBe('1 unresolved review thread');
  });

  it('keeps the three forge-native types without extras (merge-blockers payload)', () => {
    expect(types(facts({ draft: true, changesRequested: true, checks: 'red' }))).toEqual(['failing_checks']);
  });

  it('reports nothing for a closed or merged PR', () => {
    expect(blockerReasonsFor(facts({ open: false, merged: true, checks: 'red' }), {})).toEqual([]);
  });
});
