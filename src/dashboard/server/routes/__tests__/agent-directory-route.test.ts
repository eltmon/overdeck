/** PAN-3920 W4 — `?windowHours=` parsing for GET /api/agent-directory. */
import { describe, expect, it } from 'vitest';

import { parseWindowHours } from '../agent-directory.js';

describe('parseWindowHours', () => {
  it('defaults to 24 hours', () => {
    expect(parseWindowHours(null)).toBe(24);
  });

  it('accepts integers from 1 to 168', () => {
    expect(parseWindowHours('1')).toBe(1);
    expect(parseWindowHours('168')).toBe(168);
  });

  it('rejects zero, out-of-range, fractional and non-numeric values', () => {
    expect(parseWindowHours('0')).toBeNull();
    expect(parseWindowHours('169')).toBeNull();
    expect(parseWindowHours('1.5')).toBeNull();
    expect(parseWindowHours('-1')).toBeNull();
    expect(parseWindowHours('abc')).toBeNull();
    expect(parseWindowHours('')).toBeNull();
  });
});
