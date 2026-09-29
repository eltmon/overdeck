import { describe, expect, it } from 'vitest';

import { parseCpuPsi } from '../cpu-psi.js';

describe('parseCpuPsi (PAN-4311)', () => {
  it('reads some avg10 and avg60', () => {
    expect(parseCpuPsi(
      'some avg10=12.50 avg60=55.00 avg300=3.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    )).toEqual({ someAvg10: 12.5, someAvg60: 55 });
  });

  it('returns nulls for garbage', () => {
    expect(parseCpuPsi('not a pressure file')).toEqual({ someAvg10: null, someAvg60: null });
    expect(parseCpuPsi('')).toEqual({ someAvg10: null, someAvg60: null });
  });

  it('returns null for a malformed field and keeps the valid one', () => {
    expect(parseCpuPsi('some avg10=abc avg60=7.25 avg300=0 total=0'))
      .toEqual({ someAvg10: null, someAvg60: 7.25 });
  });
});
