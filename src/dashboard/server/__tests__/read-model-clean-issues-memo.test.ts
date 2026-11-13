/**
 * PAN-5178 WI-3 — cleanIssues deep-walks every issue on every getSnapshot
 * call, which also runs every 500 ms while an issue stream is open. Memoize
 * the result by the input array's identity, which IssueDataService.getIssues()
 * keeps stable until the next poll.
 */
import { describe, expect, it } from 'vitest';

import { cleanIssues } from '../read-model.js';

describe('cleanIssues memo', () => {
  it('returns the identical output array for the same input array', () => {
    const issues = [{ id: 'PAN-1', title: 'one' }];

    const first = cleanIssues(issues);
    const second = cleanIssues(issues);

    expect(second).toBe(first);
  });

  it('cleans a new input array with equal content as a new output array', () => {
    const first = cleanIssues([{ id: 'PAN-1', title: 'one' }]);
    const second = cleanIssues([{ id: 'PAN-1', title: 'one' }]);

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('converts Dates to ISO strings, non-finite numbers to null, and preserves nested objects', () => {
    const row = { at: new Date('2026-11-13T00:00:00.000Z'), n: Number.NaN, nested: { ok: true } };

    const [cleaned] = cleanIssues([row]);

    expect(cleaned).toEqual({ at: '2026-11-13T00:00:00.000Z', n: null, nested: { ok: true } });
  });

  it('accepts a frozen input array', () => {
    const issues = Object.freeze([{ id: 'PAN-1', title: 'one' }]);

    expect(() => cleanIssues(issues)).not.toThrow();
  });
});
