/**
 * The FR-6 derivation table (PAN-3917 W9).
 *
 * Every state here is computed from an owner — the tracker, the pull request,
 * git, the backend — and none of them is ever stored, so the only thing worth
 * pinning is the precedence between the rules.
 */

import { describe, expect, it } from 'vitest';

import {
  deriveIssueAttention,
  deriveIssueState,
  type IssueStateInputs,
  type PullRequestFacts,
} from '../../../../src/lib/overdeck/derived-issue-state.js';

const base: IssueStateInputs = {
  issueOpen: true,
  parked: false,
  specExists: false,
  pr: null,
  branchAheadOfMain: false,
  livePanes: 0,
};

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    state: 'OPEN',
    isDraft: false,
    reviewDecision: null,
    mergeable: 'UNKNOWN',
    checksGreen: false,
    ...overrides,
  };
}

describe('deriveIssueState', () => {
  it('backlog: open, no spec, no branch, no pane', () => {
    expect(deriveIssueState(base)).toBe('backlog');
  });

  it('parked: the parked list names it and no work has started', () => {
    expect(deriveIssueState({ ...base, parked: true })).toBe('parked');
  });

  it('planned: a spec file exists', () => {
    expect(deriveIssueState({ ...base, specExists: true })).toBe('planned');
  });

  it('working: a live pane carries the issue token', () => {
    expect(deriveIssueState({ ...base, specExists: true, livePanes: 1 })).toBe('working');
  });

  it('working: the branch is ahead of main with no pull request', () => {
    expect(deriveIssueState({ ...base, specExists: true, branchAheadOfMain: true })).toBe('working');
  });

  it('in review: the pull request is open and not a draft', () => {
    expect(deriveIssueState({ ...base, pr: pr(), branchAheadOfMain: true })).toBe('in review');
  });

  it('in review: a draft pull request with a live reviewer pane', () => {
    expect(deriveIssueState({ ...base, pr: pr({ isDraft: true }), liveReviewPanes: 1 })).toBe('in review');
  });

  it('changes requested: the latest review state says so', () => {
    expect(deriveIssueState({ ...base, pr: pr({ reviewDecision: 'CHANGES_REQUESTED' }) })).toBe('changes requested');
  });

  it('ready: approved, checks green, mergeable', () => {
    const inputs = { ...base, pr: pr({ reviewDecision: 'APPROVED', checksGreen: true, mergeable: 'MERGEABLE' as const }) };
    expect(deriveIssueState(inputs)).toBe('ready');
  });

  it('not ready while the checks are red, even when approved', () => {
    const inputs = { ...base, pr: pr({ reviewDecision: 'APPROVED', checksGreen: false, mergeable: 'MERGEABLE' as const }) };
    expect(deriveIssueState(inputs)).toBe('in review');
  });

  it('not ready while the pull request conflicts, even when approved and green', () => {
    const inputs = { ...base, pr: pr({ reviewDecision: 'APPROVED', checksGreen: true, mergeable: 'CONFLICTING' as const }) };
    expect(deriveIssueState(inputs)).toBe('in review');
  });

  it('merged: the pull request merged, even with a pane still alive', () => {
    expect(deriveIssueState({ ...base, pr: pr({ state: 'MERGED' }), livePanes: 2 })).toBe('merged');
  });

  it('closed outranks everything', () => {
    expect(deriveIssueState({ ...base, issueOpen: false, pr: pr({ state: 'MERGED' }), livePanes: 1 })).toBe('closed');
  });

  it('a live pane outranks the parked list', () => {
    expect(deriveIssueState({ ...base, parked: true, livePanes: 1 })).toBe('working');
  });
});

describe('deriveIssueAttention', () => {
  it('is nothing when the issue is moving', () => {
    expect(deriveIssueAttention({ blockedPanes: 0, idleWithUnpushedWork: false, apiError: false })).toBeNull();
  });

  it('api error outranks needs you and stuck', () => {
    expect(deriveIssueAttention({ blockedPanes: 1, idleWithUnpushedWork: true, apiError: true })).toBe('api error');
  });

  it('needs you outranks stuck', () => {
    expect(deriveIssueAttention({ blockedPanes: 1, idleWithUnpushedWork: true, apiError: false })).toBe('needs you');
  });

  it('stuck: idle with unpushed work', () => {
    expect(deriveIssueAttention({ blockedPanes: 0, idleWithUnpushedWork: true, apiError: false })).toBe('stuck');
  });
});
