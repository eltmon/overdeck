import { describe, expect, it } from 'vitest';
import { parseAffectedCriteria } from '../affected-criteria.js';

describe('parseAffectedCriteria', () => {
  it('parses affected criteria trailer values', () => {
    expect(parseAffectedCriteria(`details

Flywheel-Affects-Criterion: 1,5
`)).toEqual([1, 5]);
  });

  it('parses shorthand trailer values case-insensitively and dedupes them', () => {
    expect(parseAffectedCriteria('affects-criterion: 5 1 5')).toEqual([1, 5]);
  });

  it('parses labels without a trailer', () => {
    expect(parseAffectedCriteria(null, ['affects-criterion-3', 'substrate'])).toEqual([3]);
  });

  it('unions trailer and label values', () => {
    expect(parseAffectedCriteria('Flywheel-Affects-Criterion: 1', ['affects-criterion-3'])).toEqual([1, 3]);
  });

  it('rejects out-of-range values', () => {
    expect(parseAffectedCriteria('Flywheel-Affects-Criterion: 0,8,3')).toEqual([3]);
  });

  it('returns an empty list when no affected criterion source is present', () => {
    expect(parseAffectedCriteria(null)).toEqual([]);
    expect(parseAffectedCriteria('')).toEqual([]);
    expect(parseAffectedCriteria(`Flywheel-Run-Id: run-123
Flywheel-Filed-By: agent
`)).toEqual([]);
  });
});
