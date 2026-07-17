import { describe, it, expect } from 'vitest';

import { resolvePipelineMembership, type IssueLensSignals } from '../pipeline-membership.js';

const sig = (over: Partial<IssueLensSignals>): IssueLensSignals => ({
  issueId: 'PAN-1',
  issueOpen: true,
  hasOpenPr: false,
  hasMergedPr: false,
  hasConventionBranch: false,
  branchUnmerged: false, hasMergedBranchWork: false,
  phaseLabel: null,
  hasXbriefSpec: false,
  explicitlyReady: false,
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

  it('planned_backlog: open issue with a vBRIEF spec but no branch or PR', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasXbriefSpec: true }));
    expect(r.bucket).toBe('planned_backlog');
    expect(r.inPipeline).toBe(true);
  });

  it('planned_backlog: open issue with only the explicit ready label', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, explicitlyReady: true }));
    expect(r.bucket).toBe('planned_backlog');
    expect(r.inPipeline).toBe(true);
  });

  it('clean_terminal: closed issue with a vBRIEF spec and no open PR remains terminal', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: false, hasXbriefSpec: true }));
    expect(r.bucket).toBe('clean_terminal');
    expect(r.inPipeline).toBe(false);
  });

  it('label drift stale_present: closed issue retains an in-progress phase label', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: false, phaseLabel: 'in-progress' }));
    expect(r.bucket).toBe('clean_terminal');
    expect(r.labelDrift).toBe('stale_present');
  });

  it('label drift stale_absent: open PR has no phase label', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasOpenPr: true, phaseLabel: null }));
    expect(r.bucket).toBe('in_flight');
    expect(r.labelDrift).toBe('stale_absent');
  });

  it('closed zombie PR does not request a missing phase label', () => {
    expect(resolvePipelineMembership(sig({ issueOpen: false, hasOpenPr: true, phaseLabel: null })).labelDrift)
      .toBeNull();
    expect(resolvePipelineMembership(sig({ issueOpen: false, hasOpenPr: true, phaseLabel: 'in-review' })).labelDrift)
      .toBe('stale_present');
  });

  it('label drift absent: open PR has the in-review phase label', () => {
    const r = resolvePipelineMembership(sig({ issueOpen: true, hasOpenPr: true, phaseLabel: 'in-review' }));
    expect(r.bucket).toBe('in_flight');
    expect(r.labelDrift).toBeNull();
  });

  it('squash-merge pairing: branch reads UNMERGED (L2) but a merged PR exists → post_merge_limbo, L1-merged wins', () => {
    const r = resolvePipelineMembership(
      sig({ issueOpen: true, hasConventionBranch: true, branchUnmerged: true, hasMergedBranchWork: false, hasMergedPr: true }),
    );
    expect(r.bucket).toBe('post_merge_limbo');
    expect(r.lenses.L2_unmergedBranch).toBe(false);
  });

  it('post_merge_limbo: open issue whose branch WORK is contained in main (non-PR path, positive evidence), no merged PR', () => {
    const r = resolvePipelineMembership(sig({
      issueOpen: true, hasConventionBranch: true, branchUnmerged: false, hasMergedBranchWork: true,
    }));
    expect(r.bucket).toBe('post_merge_limbo');
  });

  it('PAN-2887: fresh zero-ahead branch (no unique commits) is planned_backlog, NOT post_merge_limbo', () => {
    // Every `pan start` creates feature/<id> at main's HEAD; until the first
    // commit the branch is contained in main with hasMergedBranchWork=false.
    const r = resolvePipelineMembership(sig({
      issueOpen: true, hasConventionBranch: true, branchUnmerged: false, hasMergedBranchWork: false,
    }));
    expect(r.bucket).toBe('planned_backlog');
    expect(r.inPipeline).toBe(true);
  });

  it('PAN-2887: contained branch without merged work stays planned_backlog even with a spec', () => {
    const r = resolvePipelineMembership(sig({
      issueOpen: true, hasConventionBranch: true, branchUnmerged: false, hasMergedBranchWork: false, hasVbriefSpec: true,
    }));
    expect(r.bucket).toBe('planned_backlog');
  });
});
