import { describe, it, expect } from 'vitest';
import { reviewersToRerun, type ReviewerVerdictsMap } from '../review-rerun-scope.js';

const ALL = ['security', 'correctness', 'performance', 'requirements'] as const;

const allPassed = (atCommit = 'abc12345'): ReviewerVerdictsMap => ({
  security: { status: 'passed', atCommit },
  correctness: { status: 'passed', atCommit },
  performance: { status: 'passed', atCommit },
  requirements: { status: 'passed', atCommit },
});

describe('reviewersToRerun (PAN-1862 FR-7 / NFR-1)', () => {
  it("scope 'all' always re-runs every reviewer", () => {
    expect(reviewersToRerun({ scope: 'all', priorVerdicts: allPassed(), changedFiles: [] })).toEqual([...ALL]);
  });

  it('first cycle (no prior verdicts) runs every reviewer regardless of scope', () => {
    expect(reviewersToRerun({ scope: 'blockers' })).toEqual([...ALL]);
    expect(reviewersToRerun({ scope: 'changed', changedFiles: ['a.ts'] })).toEqual([...ALL]);
  });

  it("scope 'blockers' re-runs only the reviewers that blocked", () => {
    const verdicts = { ...allPassed(), correctness: { status: 'blocked' as const, atCommit: 'abc12345' } };
    expect(reviewersToRerun({ scope: 'blockers', priorVerdicts: verdicts, changedFiles: ['x.ts'] }))
      .toEqual(['correctness']);
  });

  it('a verdict without a commit anchor cannot be skipped — the reviewer always re-runs', () => {
    const verdicts = { ...allPassed(), security: { status: 'passed' as const } }; // no atCommit
    expect(reviewersToRerun({ scope: 'blockers', priorVerdicts: verdicts, changedFiles: [] }))
      .toEqual(['security']);
  });

  it("scope 'changed': correctness + requirements re-run whenever ANY file changed", () => {
    const result = reviewersToRerun({
      scope: 'changed',
      priorVerdicts: allPassed(),
      changedFiles: ['docs/README.md'],
    });
    expect(result).toContain('correctness');
    expect(result).toContain('requirements');
    expect(result).not.toContain('security');
    expect(result).not.toContain('performance');
  });

  it("scope 'changed': security re-runs when a security-sensitive path changed", () => {
    const result = reviewersToRerun({
      scope: 'changed',
      priorVerdicts: allPassed(),
      changedFiles: ['src/lib/auth/session.ts'],
    });
    expect(result).toContain('security');
  });

  it("scope 'changed': performance re-runs when a hot-path file changed", () => {
    const result = reviewersToRerun({
      scope: 'changed',
      priorVerdicts: allPassed(),
      changedFiles: ['src/lib/database/query-cache.ts'],
    });
    expect(result).toContain('performance');
  });

  it("scope 'changed' with an UNKNOWN changed set runs everyone (fail toward quality)", () => {
    expect(reviewersToRerun({ scope: 'changed', priorVerdicts: allPassed() })).toEqual([...ALL]);
  });

  it("scope 'changed' with an empty changed set re-runs only blockers", () => {
    const verdicts = { ...allPassed(), performance: { status: 'blocked' as const, atCommit: 'abc12345' } };
    expect(reviewersToRerun({ scope: 'changed', priorVerdicts: verdicts, changedFiles: [] }))
      .toEqual(['performance']);
  });

  it('preserves canonical sub-role ordering in the result', () => {
    const verdicts = {
      ...allPassed(),
      requirements: { status: 'blocked' as const, atCommit: 'abc12345' },
      security: { status: 'blocked' as const, atCommit: 'abc12345' },
    };
    expect(reviewersToRerun({ scope: 'blockers', priorVerdicts: verdicts, changedFiles: [] }))
      .toEqual(['security', 'requirements']);
  });
});
