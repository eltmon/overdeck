import { describe, it, expect } from 'vitest';
import { parseAffectedCriteria } from '../affected-criteria.js';

describe('parseAffectedCriteria', () => {
  it('parses a Flywheel-Affects-Criterion trailer with comma-separated values', () => {
    const body = 'Some issue body\n---\nFlywheel-Affects-Criterion: 1,5\n';
    expect(parseAffectedCriteria(body)).toEqual([1, 5]);
  });

  it('parses space-separated values and deduplicates', () => {
    const body = '---\nAffects-Criterion: 5 1 5\n---';
    expect(parseAffectedCriteria(body)).toEqual([1, 5]);
  });

  it('is case-insensitive', () => {
    const body = 'FLYWHEEL-AFFECTS-CRITERION: 2,4';
    expect(parseAffectedCriteria(body)).toEqual([2, 4]);
  });

  it('parses affects-criterion labels when no trailer is present', () => {
    expect(parseAffectedCriteria(null, ['affects-criterion-3', 'substrate'])).toEqual([3]);
  });

  it('unions trailer and labels, sorted', () => {
    const body = 'Flywheel-Affects-Criterion: 1\n';
    expect(parseAffectedCriteria(body, ['affects-criterion-3'])).toEqual([1, 3]);
  });

  it('rejects out-of-range values', () => {
    const body = 'Flywheel-Affects-Criterion: 0,8,3,10';
    expect(parseAffectedCriteria(body)).toEqual([3]);
  });

  it('returns [] for null/empty body and no labels', () => {
    expect(parseAffectedCriteria(null)).toEqual([]);
    expect(parseAffectedCriteria('')).toEqual([]);
    expect(parseAffectedCriteria('No trailer here')).toEqual([]);
  });

  it('returns [] when only other Flywheel trailers are present', () => {
    const body = '---\nFlywheel-Run-Id: RUN-123\nFlywheel-Filed-By: agent\n---';
    expect(parseAffectedCriteria(body)).toEqual([]);
  });

  it('ignores non-numeric trailer tokens and malformed labels', () => {
    const body = 'Flywheel-Affects-Criterion: 1,foo,7';
    expect(parseAffectedCriteria(body, ['affects-criterion-abc', 'affects-criterion-2'])).toEqual([1, 2, 7]);
  });
});
