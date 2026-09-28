import { describe, expect, it } from 'vitest';
import { acceptFlagFor, buildAbandonedDodGate, buildResidueDodGate, describeTeardownObserved, DOD_ROWS } from '../../../../src/lib/lifecycle/dod.js';

describe('DOD_ROWS', () => {
  it('defines the nine uniquely identified rows in order', () => {
    expect(DOD_ROWS.map(row => row.id)).toEqual([
      'review',
      'tests',
      'verification',
      'merged',
      'post-merge',
      'main-verify',
      'ship',
      'deploy',
      'teardown',
    ]);
    expect(new Set(DOD_ROWS.map(row => row.id)).size).toBe(DOD_ROWS.length);
    expect(DOD_ROWS.map(row => row.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('allows overrides for rows one through eight only', () => {
    expect(DOD_ROWS.map(row => row.overridable)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('derives the accept flag from each overridable row id', () => {
    expect(DOD_ROWS.filter(row => row.overridable).map(acceptFlagFor)).toEqual([
      '--accept-review',
      '--accept-tests',
      '--accept-verification',
      '--accept-merged',
      '--accept-post-merge',
      '--accept-main-verify',
      '--accept-ship',
      '--accept-deploy',
    ]);
  });
});

describe('buildAbandonedDodGate', () => {
  it('returns all-skip gate with abandon disposition and kind field', () => {
    const result = buildAbandonedDodGate('no landing evidence', 'conv-x');
    expect(result.passed).toBe(true);
    expect(result.rows.every(row => row.status === 'skip')).toBe(true);
    expect(result.disposition).toEqual({
      reason: 'no landing evidence',
      by: 'conv-x',
      kind: 'abandon',
    });
  });
});

describe('buildResidueDodGate', () => {
  it('returns all-skip gate with residue disposition, kind field, and evidence in observed', () => {
    const result = buildResidueDodGate('pre-record-era stale PR', 'conv-y', ['MIN-572: closed out on 2026-07-23', 'Closed PR #42 with honest comment']);
    expect(result.passed).toBe(true);
    expect(result.rows.every(row => row.status === 'skip')).toBe(true);
    expect(result.rows[0]?.observed).toContain('Verified: MIN-572: closed out on 2026-07-23; Closed PR #42 with honest comment');
    expect(result.disposition).toEqual({
      reason: 'pre-record-era stale PR',
      by: 'conv-y',
      kind: 'residue',
    });
  });
});

describe('describeTeardownObserved', () => {
  it('reports a kept workspace when remove_workspace is off', () => {
    const observed = describeTeardownObserved([], { removeWorkspace: false, deleteBranches: false });
    expect(observed.startsWith('workspace kept (close_out.remove_workspace is off)')).toBe(true);
  });

  it('reports the workspace removed when remove_workspace is on and the step succeeded', () => {
    const observed = describeTeardownObserved(
      [{ step: 'teardown:worktree', success: true, skipped: false }],
      { removeWorkspace: true, deleteBranches: true },
    );
    expect(observed.startsWith('workspace removed')).toBe(true);
    expect(observed).not.toContain('kept (close_out.remove_workspace');
  });

  it('reports no workspace on disk when remove_workspace is on but no worktree step ran', () => {
    const observed = describeTeardownObserved([], { removeWorkspace: true, deleteBranches: true });
    expect(observed.startsWith('no workspace on disk')).toBe(true);
  });

  it('reports the branch kept when delete_feature_branch is off', () => {
    const observed = describeTeardownObserved([], { removeWorkspace: false, deleteBranches: false });
    expect(observed).toContain('feature branch kept');
  });

  it('appends step details after the clauses', () => {
    const observed = describeTeardownObserved(
      [{ step: 'teardown:agent-state', success: true, skipped: false, details: ['pruned agent-pan-100'] }],
      { removeWorkspace: false, deleteBranches: false },
    );
    expect(observed).toBe('workspace kept (close_out.remove_workspace is off); feature branch kept (close_out.delete_feature_branch is off); pruned agent-pan-100');
  });
});
