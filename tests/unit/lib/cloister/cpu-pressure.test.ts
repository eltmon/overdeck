import { describe, expect, it } from 'vitest';

import { classifyCpuPressure } from '../../../../src/lib/cloister/cpu-pressure.js';

const thresholds = { psiHoldAvg60: 50, loadHoldPerCore: 1.5 };

describe('classifyCpuPressure (PAN-4311)', () => {
  it('is saturated when PSI some avg60 reaches the hold threshold', () => {
    expect(classifyCpuPressure({ psiSomeAvg10: 60, psiSomeAvg60: 55, loadPerCore: 0.2 }, thresholds)).toEqual({
      saturated: true,
      signal: 'psi-some-avg60',
      reading: 55,
      threshold: 50,
      psiSomeAvg10: 60,
    });
  });

  it('is not saturated below the PSI threshold, even with a high load per core', () => {
    expect(classifyCpuPressure({ psiSomeAvg10: 10, psiSomeAvg60: 20, loadPerCore: 3 }, thresholds))
      .toMatchObject({ saturated: false, signal: 'psi-some-avg60', reading: 20 });
  });

  it('falls back to load per core when PSI is unavailable', () => {
    expect(classifyCpuPressure({ psiSomeAvg10: null, psiSomeAvg60: null, loadPerCore: 1.6 }, thresholds))
      .toEqual({ saturated: true, signal: 'load-per-core', reading: 1.6, threshold: 1.5, psiSomeAvg10: null });
    expect(classifyCpuPressure({ psiSomeAvg10: null, psiSomeAvg60: null, loadPerCore: 1.2 }, thresholds))
      .toMatchObject({ saturated: false, signal: 'load-per-core' });
  });
});
