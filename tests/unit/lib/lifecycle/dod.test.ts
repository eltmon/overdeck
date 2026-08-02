import { describe, expect, it } from 'vitest';
import { acceptFlagFor, buildAbandonedDodGate, buildResidueDodGate, DOD_ROWS } from '../../../../src/lib/lifecycle/dod.js';

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
