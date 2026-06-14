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

  it('assigns codenames in order using the default start index', () => {
    const label = 'pan';
    const dateIso = '2026-06-14T00:00:00Z';
    const codenames = ['otter', 'falcon', 'cedar'];

    expect(
      makeUatCandidateName({ label, dateIso, codenames }),
    ).toBe('uat/pan-otter-0614');
    expect(
      makeUatCandidateName({
        label,
        dateIso,
        codenames,
        isTaken: (b) => b === 'uat/pan-otter-0614',
      }),
    ).toBe('uat/pan-falcon-0614');
    expect(
      makeUatCandidateName({
        label,
        dateIso,
        codenames,
        isTaken: (b) =>
          b === 'uat/pan-otter-0614' || b === 'uat/pan-falcon-0614',
      }),
    ).toBe('uat/pan-cedar-0614');
  });

  it('is deterministic for identical inputs without an injected pick', () => {
    const deps = {
      label: 'pan',
      dateIso: '2026-06-14T00:00:00Z',
      codenames: ['otter', 'falcon'],
      isTaken: (b: string) => b === 'uat/pan-otter-0614',
    };
    const first = makeUatCandidateName(deps);
    const second = makeUatCandidateName(deps);
    expect(first).toBe('uat/pan-falcon-0614');
    expect(second).toBe(first);
  });

  it('falls back to a numeric suffix when every default codename is taken', () => {
    const name = makeUatCandidateName({
      label: 'pan',
      dateIso: '2026-06-14T00:00:00Z',
      codenames: ['otter'],
      isTaken: (b) => b === 'uat/pan-otter-0614',
    });
    expect(name).toBe('uat/pan-otter-0614-2');
  });
});
