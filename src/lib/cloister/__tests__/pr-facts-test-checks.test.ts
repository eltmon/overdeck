/**
 * PAN-3965 (review of #3993): the CI test job's failing checks carry their
 * conclusions, so the relay can tell a cancelled run from a failed test.
 */
import { describe, expect, it } from 'vitest';

import { listFailedTestChecks, summarizeTestChecks } from '../pr-facts.js';

describe('listFailedTestChecks', () => {
  it('lists only failing test checks, with the conclusion GitHub reported', () => {
    const rollup = [
      { name: 'test-shard (1/4)', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'test-shard (2/4)', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { name: 'test-shard (3/4)', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test-shard (4/4)', status: 'IN_PROGRESS' },
      { name: 'test-e2e', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'test (legacy status)', state: 'ERROR' },
    ];

    expect(listFailedTestChecks(rollup)).toEqual([
      { name: 'test-shard (1/4)', conclusion: 'FAILURE' },
      { name: 'test-shard (2/4)', conclusion: 'CANCELLED' },
      { name: 'test-e2e', conclusion: 'TIMED_OUT' },
      { name: 'test (legacy status)', conclusion: 'ERROR' },
    ]);
    expect(summarizeTestChecks(rollup)).toBe('red');
  });

  it('is empty for a green or absent rollup', () => {
    expect(listFailedTestChecks([{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }])).toEqual([]);
    expect(listFailedTestChecks(undefined)).toEqual([]);
  });
});
