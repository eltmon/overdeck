/**
 * PAN-4820 WI-7: a Deft issue's open, green, mergeable PR derives `ready`
 * without an Overdeck approval; the same PR on Overdeck's pipeline stays
 * `in-review`.
 */
import { describe, expect, it } from 'vitest';
import { deriveIssueState, type IssueStateFacts } from '../../overdeck/derived-issue-state.js';

function facts(overrides: Partial<IssueStateFacts> = {}): IssueStateFacts {
  return {
    issueId: 'PAN-1',
    issueOpen: true,
    labels: [],
    parkedListed: false,
    specExists: true,
    panes: [],
    prMerged: false,
    apiError: false,
    now: Date.parse('2026-11-02T12:00:00Z'),
    pr: { url: 'https://github.com/eltmon/overdeck/pull/1', number: 1, reviewState: 'review-requested', checks: 'green', mergeable: true },
    prApprovedAtHead: false,
    ...overrides,
  };
}

describe('deriveIssueState for a Deft PR', () => {
  it('is ready with no approval when green and mergeable', () => {
    expect(deriveIssueState(facts({ deftPipeline: true })).state).toBe('ready');
  });

  it('is in review without the Deft fact', () => {
    expect(deriveIssueState(facts()).state).toBe('in-review');
  });

  it('still needs green checks and mergeability', () => {
    expect(deriveIssueState(facts({ deftPipeline: true, pr: { url: 'u', number: 1, reviewState: 'review-requested', checks: 'pending', mergeable: true } })).state)
      .toBe('in-review');
    expect(deriveIssueState(facts({ deftPipeline: true, pr: { url: 'u', number: 1, reviewState: 'changes-requested', checks: 'green', mergeable: true } })).state)
      .toBe('changes-requested');
  });
});
