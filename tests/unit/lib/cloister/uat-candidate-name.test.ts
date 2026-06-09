import { describe, it, expect } from 'vitest';
import { makeUatCandidateName } from '../../../../src/lib/cloister/uat-candidate-name.js';

describe('makeUatCandidateName (PAN-1691 codename + short date)', () => {
  it('builds uat/<label>-<codename>-<MMDD>', () => {
    const name = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-09T14:30:00.000Z',
      codenames: ['otter', 'falcon'],
      pick: () => 0,
    });
    expect(name).toBe('uat/pan-otter-0609');
  });

  it('skips a taken codename and uses the next', () => {
    const name = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-09T00:00:00Z',
      codenames: ['otter', 'falcon'],
      pick: () => 0,
      isTaken: (b) => b === 'uat/pan-otter-0609',
    });
    expect(name).toBe('uat/pan-falcon-0609');
  });

  it('appends a numeric suffix when every codename for the day is taken', () => {
    const name = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-09T00:00:00Z',
      codenames: ['otter'],
      pick: () => 0,
      isTaken: (b) => b === 'uat/pan-otter-0609',
    });
    expect(name).toBe('uat/pan-otter-0609-2');
  });

  it('zero-pads the month/day', () => {
    const name = makeUatCandidateName({
      label: 'min',
      dateIso: '2026-01-03T00:00:00Z',
      codenames: ['cedar'],
      pick: () => 0,
    });
    expect(name).toBe('uat/min-cedar-0103');
  });
});
