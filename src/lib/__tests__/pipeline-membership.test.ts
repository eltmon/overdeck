import { describe, it, expect } from 'vitest';

import { resolvePipelineMembership, type IssueLensSignals } from '../pipeline-membership.js';

const sig = (over: Partial<IssueLensSignals>): IssueLensSignals => ({
  issueId: 'PAN-1',
  issueOpen: true,
  hasOpenPr: false,
  hasMergedPr: false,
  hasConventionBranch: false,
  branchUnmerged: false,
  phaseLabel: null,
  ...over,
});

describe('resolvePipelineMembership (PAN-1980)', () => {
  it('in_flight: open issue with an open PR', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasOpenPr: true }));
    expect(r.bucket).toBe('in_flight');
    expect(r.inPipeline).toBe(true);
  });

  it('zombie_pr: closed issue but a PR is still open', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: false, hasOpenPr: true }));
    expect(r.bucket).toBe('zombie_pr');
    expect(r.inPipeline).toBe(true);
  });

  it('post_merge_limbo: open issue with a merged PR (never closed out)', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasMergedPr: true }));
    expect(r.bucket).toBe('post_merge_limbo');
    expect(r.inPipeline).toBe(true);
  });

  it('planned_backlog: open issue with an unmerged branch but no PR', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasConventionBranch: true, branchUnmerged: true }));
    expect(r.bucket).toBe('planned_backlog');
    expect(r.inPipeline).toBe(true);
  });

  it('clean_terminal: closed issue, no open PR — terminal even with a leftover unmerged branch (orphan ≠ pipeline)', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: false, hasConventionBranch: true, branchUnmerged: true }));
    expect(r.bucket).toBe('clean_terminal');
    expect(r.inPipeline).toBe(false);
  });

  it('clean_terminal: open issue with no branch and no PR — backlog, never started', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true }));
    expect(r.bucket).toBe('clean_terminal');
    expect(r.inPipeline).toBe(false);
  });

  it('squash-merge pairing: branch reads UNMERGED (L2) but a merged PR exists → post_merge_limbo, L1-merged wins', () => {
    const r = resolvePipelineMembership(
      sig({ issueOpen: true, hasConventionBranch: true, branchUnmerged: true, hasMergedPr: true }),
    );
    expect(r.bucket).toBe('post_merge_limbo');
    expect(r.lenses.L2_unmergedBranch).toBe(false);
  });

  it('post_merge_limbo: open issue whose branch is already in main (non-PR path), no merged PR', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasConventionBranch: true, branchUnmerged: false }));
    expect(r.bucket).toBe('post_merge_limbo');
  });
});
