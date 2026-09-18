import { describe, expect, it } from 'vitest';
import type { BackendPane } from '@overdeck/contracts';

import {
  DEFAULT_STUCK_AFTER_MS,
  deriveIssueState,
  issueIdFromBranch,
  mrFromGlabRow,
  toChecksState,
  toChecksStateFromPipeline,
  toReviewState,
  type IssueStateFacts,
} from '../derived-issue-state.js';

const NOW = 1_800_000_000_000;

function facts(overrides: Partial<IssueStateFacts> = {}): IssueStateFacts {
  return {
    issueId: 'PAN-3917',
    issueOpen: true,
    labels: [],
    parkedListed: false,
    specExists: false,
    panes: [],
    prMerged: false,
    apiError: false,
    now: NOW,
    ...overrides,
  };
}

function pane(overrides: Partial<BackendPane> = {}): BackendPane {
  return {
    id: 'w1:p1',
    issue: 'PAN-3917',
    role: 'work',
    harness: 'claude-code',
    model: 'claude-opus-5',
    state: 'working',
    stateSince: NOW,
    ...overrides,
  };
}

describe('deriveIssueState — the nine FR-6 rows', () => {
  it('backlog: issue open, no spec file', () => {
    expect(deriveIssueState(facts()).state).toBe('backlog');
  });

  it('parked: tracker label `parked`', () => {
    expect(deriveIssueState(facts({ labels: ['parked'], specExists: true })).state).toBe('parked');
  });

  it('parked: listed in .pan/parked.md', () => {
    expect(deriveIssueState(facts({ parkedListed: true })).state).toBe('parked');
  });

  it('planned: spec file exists', () => {
    expect(deriveIssueState(facts({ specExists: true })).state).toBe('planned');
  });

  it('working: a live pane carries this issue token', () => {
    expect(deriveIssueState(facts({ specExists: true, panes: [pane()] })).state).toBe('working');
  });

  it('working: feature branch ahead of main with no PR', () => {
    const state = deriveIssueState(facts({
      specExists: true,
      branch: { name: 'feature/pan-3917', aheadOfMain: 3, pushed: true },
    }));
    expect(state.state).toBe('working');
  });

  it('in-review: PR open with review requested', () => {
    const state = deriveIssueState(facts({
      pr: { url: 'u', number: 12, reviewState: 'review-requested', checks: 'pending', mergeable: null },
    }));
    expect(state.state).toBe('in-review');
  });

  it('in-review: a reviewer pane is live even with no PR review request', () => {
    const state = deriveIssueState(facts({
      panes: [pane({ id: 'w1:p2', role: 'review' })],
      pr: { url: 'u', number: 12, reviewState: 'none', checks: 'pending', mergeable: null },
    }));
    expect(state.state).toBe('in-review');
  });

  it('changes-requested: latest PR review state is CHANGES_REQUESTED', () => {
    const state = deriveIssueState(facts({
      panes: [pane()],
      pr: { url: 'u', number: 12, reviewState: 'changes-requested', checks: 'green', mergeable: true },
    }));
    expect(state.state).toBe('changes-requested');
  });

  it('ready: PR approved, checks green, mergeable true', () => {
    const state = deriveIssueState(facts({
      pr: { url: 'u', number: 12, reviewState: 'approved', checks: 'green', mergeable: true },
    }));
    expect(state.state).toBe('ready');
  });

  it('ready needs all three: approved with red checks is not ready', () => {
    const state = deriveIssueState(facts({
      pr: { url: 'u', number: 12, reviewState: 'approved', checks: 'red', mergeable: true },
    }));
    expect(state.state).not.toBe('ready');
  });

  it('merged: PR merged', () => {
    const state = deriveIssueState(facts({
      prMerged: true,
      pr: { url: 'u', number: 12, reviewState: 'none', checks: 'green', mergeable: null },
    }));
    expect(state.state).toBe('merged');
  });

  it('closed: issue closed outranks everything', () => {
    const state = deriveIssueState(facts({
      issueOpen: false,
      prMerged: true,
      panes: [pane()],
      pr: { url: 'u', number: 12, reviewState: 'approved', checks: 'green', mergeable: true },
    }));
    expect(state.state).toBe('closed');
  });
});

describe('deriveIssueState — precedence', () => {
  it('an open PR with a review requested beats the parked label (W1 note)', () => {
    const state = deriveIssueState(facts({
      labels: ['parked'],
      pr: { url: 'u', number: 12, reviewState: 'review-requested', checks: 'pending', mergeable: null },
    }));
    expect(state.state).toBe('in-review');
  });

  it('a live work pane beats parked', () => {
    expect(deriveIssueState(facts({ labels: ['parked'], panes: [pane()] })).state).toBe('working');
  });

  it('an exited pane does not make an issue working', () => {
    const state = deriveIssueState(facts({ specExists: true, panes: [pane({ state: 'exited' })] }));
    expect(state.state).toBe('planned');
  });
});

describe('deriveIssueState — the three attention states', () => {
  it('needs-you: a blocked pane is an unanswered question or a permission prompt', () => {
    const state = deriveIssueState(facts({ panes: [pane({ state: 'blocked' })] }));
    expect(state.attention).toBe('needs-you');
  });

  it('stuck: idle past the threshold with unpushed commits', () => {
    const state = deriveIssueState(facts({
      panes: [pane({ state: 'idle', stateSince: NOW - DEFAULT_STUCK_AFTER_MS - 1 })],
      branch: { name: 'feature/pan-3917', aheadOfMain: 2, pushed: false },
    }));
    expect(state.attention).toBe('stuck');
  });

  it('stuck needs unpushed work: an idle pane on a pushed branch is not stuck', () => {
    const state = deriveIssueState(facts({
      panes: [pane({ state: 'idle', stateSince: NOW - DEFAULT_STUCK_AFTER_MS - 1 })],
      branch: { name: 'feature/pan-3917', aheadOfMain: 2, pushed: true },
    }));
    expect(state.attention).toBeUndefined();
  });

  it('api-error: provider failure text in a pane', () => {
    const state = deriveIssueState(facts({ panes: [pane()], apiError: true }));
    expect(state.attention).toBe('api-error');
  });

  it('needs-you outranks api-error', () => {
    const state = deriveIssueState(facts({ panes: [pane({ state: 'blocked' })], apiError: true }));
    expect(state.attention).toBe('needs-you');
  });

  it('no attention when nothing is wrong', () => {
    expect(deriveIssueState(facts({ panes: [pane()] })).attention).toBeUndefined();
  });
});

describe('deriveIssueState — payload', () => {
  it('carries the PR and branch facts through unchanged', () => {
    const pr = { url: 'https://github.com/o/r/pull/12', number: 12, reviewState: 'approved' as const, checks: 'green' as const, mergeable: true };
    const branch = { name: 'feature/pan-3917', aheadOfMain: 4, pushed: true };
    const state = deriveIssueState(facts({ pr, branch }));
    expect(state).toEqual({ issueId: 'PAN-3917', state: 'ready', pr, branch });
  });
});

describe('forge shape translation', () => {
  it('maps gh reviewDecision to the contract review state', () => {
    expect(toReviewState('APPROVED', false)).toBe('approved');
    expect(toReviewState('CHANGES_REQUESTED', false)).toBe('changes-requested');
    expect(toReviewState('REVIEW_REQUIRED', false)).toBe('review-requested');
    expect(toReviewState(null, true)).toBe('review-requested');
    expect(toReviewState(null, false)).toBe('none');
  });

  it('maps statusCheckRollup to the aggregate check state', () => {
    expect(toChecksState([])).toBe('pending');
    expect(toChecksState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('green');
    expect(toChecksState([{ status: 'COMPLETED', conclusion: 'SKIPPED' }])).toBe('green');
    expect(toChecksState([{ status: 'COMPLETED', conclusion: 'FAILURE' }])).toBe('red');
    expect(toChecksState([{ status: 'IN_PROGRESS' }])).toBe('pending');
  });
});

describe('deriveIssueState — an open PR is always the pipeline\'s move', () => {
  it('an open PR with no review decision and pending checks is in-review, not parked', () => {
    const state = deriveIssueState(facts({
      labels: ['parked'],
      pr: { url: 'u', number: 12, reviewState: 'none', checks: 'pending', mergeable: null },
    }));
    expect(state.state).toBe('in-review');
  });

  it('an open PR with green checks and no approval is still in-review, not planned', () => {
    const state = deriveIssueState(facts({
      specExists: true,
      pr: { url: 'u', number: 12, reviewState: 'commented', checks: 'green', mergeable: true },
    }));
    expect(state.state).toBe('in-review');
  });
});

describe('forge shape translation — GitLab', () => {
  it('maps a pipeline status to the aggregate check state', () => {
    expect(toChecksStateFromPipeline('success')).toBe('green');
    expect(toChecksStateFromPipeline('skipped')).toBe('green');
    expect(toChecksStateFromPipeline('failed')).toBe('red');
    expect(toChecksStateFromPipeline('running')).toBe('pending');
    expect(toChecksStateFromPipeline(undefined)).toBe('pending');
  });

  it('maps an open merge request, conflicts and all', () => {
    expect(mrFromGlabRow({
      iid: 7, web_url: 'https://gitlab.com/g/r/-/merge_requests/7', state: 'opened',
      detailed_merge_status: 'mergeable', approved: true, head_pipeline: { status: 'success' },
    })).toEqual({
      url: 'https://gitlab.com/g/r/-/merge_requests/7', number: 7,
      reviewState: 'approved', checks: 'green', mergeable: true, merged: false,
    });
    expect(mrFromGlabRow({ iid: 7, state: 'opened', has_conflicts: true })?.mergeable).toBe(false);
    expect(mrFromGlabRow({ iid: 7, state: 'merged' })?.merged).toBe(true);
    // A closed-unmerged MR is not this issue's MR any more.
    expect(mrFromGlabRow({ iid: 7, state: 'closed' })).toBeNull();
  });
});

describe('issueIdFromBranch', () => {
  it('reads the issue out of a feature branch and nothing else', () => {
    expect(issueIdFromBranch('feature/pan-3917')).toBe('PAN-3917');
    expect(issueIdFromBranch('feature/min-1039')).toBe('MIN-1039');
    expect(issueIdFromBranch('main')).toBeNull();
    expect(issueIdFromBranch(undefined)).toBeNull();
  });
});
