/**
 * #4036: the UAT verdict comment carries a machine marker with the commit UAT
 * exercised, and merge readiness reads it back through `parseUatVerdict`.
 */
import { describe, expect, it } from 'vitest';

import { parseUatVerdict } from '../../../lib/cloister/pr-facts.js';
import { formatVerdictBody } from '../specialists/done.js';

describe('formatVerdictBody UAT marker', () => {
  it('anchors a test verdict with --uat-status failed on the tested commit', () => {
    const body = formatVerdictBody(
      'test',
      'passed',
      'suite green',
      { status: 'failed', notes: 'checkout button missing' },
      { status: 'failed', sha: 'ABC1234' },
    );
    expect(body).toContain('**browser UAT: failed**');
    expect(parseUatVerdict(body)).toEqual({ status: 'failed', sha: 'abc1234' });
  });

  it('anchors a uat-role pass on the PR head', () => {
    const body = formatVerdictBody('uat', 'passed', 'all criteria observed', undefined, { status: 'passed', sha: 'def5678' });
    expect(parseUatVerdict(body)).toEqual({ status: 'passed', sha: 'def5678' });
  });

  it('adds no marker to a verdict that carries no UAT result', () => {
    const body = formatVerdictBody('test', 'failed', 'lint');
    expect(body).not.toContain('overdeck-uat');
    expect(parseUatVerdict(body)).toBeNull();
  });
});
