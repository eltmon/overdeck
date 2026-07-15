import { describe, expect, it } from 'vitest';
import { acceptFlagFor, DOD_ROWS } from '../../../../src/lib/lifecycle/dod.js';

describe('DOD_ROWS', () => {
  it('defines the eight uniquely identified rows in order', () => {
    expect(DOD_ROWS.map(row => row.id)).toEqual([
      'review',
      'tests',
      'verification',
      'merged',
      'post-merge',
      'main-verify',
      'deploy',
      'teardown',
    ]);
    expect(new Set(DOD_ROWS.map(row => row.id)).size).toBe(DOD_ROWS.length);
    expect(DOD_ROWS.map(row => row.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('allows overrides for rows one through seven only', () => {
    expect(DOD_ROWS.map(row => row.overridable)).toEqual([
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
      '--accept-deploy',
    ]);
  });
});
