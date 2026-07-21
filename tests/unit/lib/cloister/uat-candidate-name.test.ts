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

  it('uses the same codename for the same label and day', () => {
    const first = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-09T00:00:00Z',
      codenames: ['otter', 'falcon'],
    });
    const second = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-09T23:59:59Z',
      codenames: ['otter', 'falcon'],
    });
    expect(second).toBe(first);
  });

  it('can produce different codenames for different labels on the same day', () => {
    const pan = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-09T00:00:00Z',
      codenames: ['otter', 'falcon'],
    });
    const min = makeUatCandidateName({
      label: 'min',
      dateIso: '2026-06-09T00:00:00Z',
      codenames: ['otter', 'falcon'],
    });
    expect(pan).not.toBe(min);
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
