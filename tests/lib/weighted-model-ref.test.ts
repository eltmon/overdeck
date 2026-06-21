import { describe, it, expect } from 'vitest';
import {
  fnv1a32,
  pickWeightedModelRef,
  representativeModelRef,
  resolveModel,
} from '../../src/lib/config-yaml.js';

describe('fnv1a32', () => {
  it('returns the same value on repeated calls', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a32('some-key');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('produces different values for different inputs', () => {
    expect(fnv1a32('work:pan-1')).not.toBe(fnv1a32('work:pan-2'));
  });
});

describe('pickWeightedModelRef', () => {
  const ab70_30 = [
    { model: 'model-a', weight: 70 },
    { model: 'model-b', weight: 30 },
  ];

  const ab7_3 = [
    { model: 'model-a', weight: 7 },
    { model: 'model-b', weight: 3 },
  ];

  it('returns the same model for the same spawnKey (deterministic)', () => {
    const key = 'work:pan-1832';
    expect(pickWeightedModelRef(ab70_30, key)).toBe(pickWeightedModelRef(ab70_30, key));
  });

  it('returns only entries from the distribution', () => {
    for (let i = 0; i < 200; i++) {
      const result = pickWeightedModelRef(ab70_30, `key-${i}`);
      expect(['model-a', 'model-b']).toContain(result);
    }
  });

  it('realizes the intended 70/30 ratio within ±5 percentage points over 1000 keys', () => {
    let countA = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickWeightedModelRef(ab70_30, `spawn-key-${i}`) === 'model-a') countA++;
    }
    const ratioA = countA / 1000;
    expect(ratioA).toBeGreaterThanOrEqual(0.65);
    expect(ratioA).toBeLessThanOrEqual(0.75);
  });

  it('proportional weights: {7,3} and {70,30} produce identical per-key picks', () => {
    for (let i = 0; i < 1000; i++) {
      const key = `spawn-key-${i}`;
      expect(pickWeightedModelRef(ab7_3, key)).toBe(pickWeightedModelRef(ab70_30, key));
    }
  });

  it('throws when all entries have weight <= 0', () => {
    expect(() =>
      pickWeightedModelRef([{ model: 'model-a', weight: 0 }, { model: 'model-b', weight: -1 }], 'key'),
    ).toThrow('all entries have weight <= 0');
  });

  it('throws for an empty list (totalWeight is 0)', () => {
    expect(() => pickWeightedModelRef([], 'key')).toThrow('all entries have weight <= 0');
  });

  it('ignores entries with non-positive weights when positive ones exist', () => {
    const entries = [
      { model: 'model-a', weight: -5 },
      { model: 'model-b', weight: 0 },
      { model: 'model-c', weight: 100 },
    ];
    expect(pickWeightedModelRef(entries, 'any-key')).toBe('model-c');
  });

  it('returns the only positive-weight entry regardless of key', () => {
    const entries = [{ model: 'model-x', weight: 1 }];
    expect(pickWeightedModelRef(entries, 'any-key')).toBe('model-x');
    expect(pickWeightedModelRef(entries, 'another-key')).toBe('model-x');
  });
});

describe('representativeModelRef', () => {
  it('returns the model with the highest weight', () => {
    const entries = [
      { model: 'cheap', weight: 10 },
      { model: 'expensive', weight: 90 },
      { model: 'mid', weight: 30 },
    ];
    expect(representativeModelRef(entries)).toBe('expensive');
  });

  it('returns the first entry on a weight tie', () => {
    const entries = [
      { model: 'first', weight: 50 },
      { model: 'second', weight: 50 },
    ];
    expect(representativeModelRef(entries)).toBe('first');
  });

  it('returns the sole entry when only one entry exists', () => {
    expect(representativeModelRef([{ model: 'only', weight: 100 }])).toBe('only');
  });
});

describe('resolveModel with distribution (RoleModelRef array)', () => {
  const workhorses = {
    expensive: 'claude-opus-4-8',
    mid: 'claude-sonnet-4-6',
    cheap: 'claude-haiku-4-5',
  };

  const distConfig = {
    workhorses,
    roles: {
      work: {
        model: [
          { model: 'claude-opus-4-8', weight: 70 },
          { model: 'claude-sonnet-4-6', weight: 30 },
        ],
        sub: {
          inspect: { model: 'workhorse:cheap' },
        },
      },
    },
  } as Parameters<typeof resolveModel>[2];

  it('samples the distribution by spawnKey', () => {
    const result = resolveModel('work', undefined, distConfig, 'issue:pan-1832');
    expect(['claude-opus-4-8', 'claude-sonnet-4-6']).toContain(result);
  });

  it('is deterministic: same spawnKey always returns same model', () => {
    const key = 'issue:pan-1832';
    expect(resolveModel('work', undefined, distConfig, key)).toBe(
      resolveModel('work', undefined, distConfig, key),
    );
  });

  it('without spawnKey returns the representative (highest-weight) model', () => {
    expect(resolveModel('work', undefined, distConfig)).toBe('claude-opus-4-8');
  });

  it('sub-role takes precedence over parent distribution even with a spawnKey', () => {
    expect(resolveModel('work', 'inspect', distConfig, 'any-key')).toBe('claude-haiku-4-5');
  });

  it('resolves a workhorse ref inside a distribution entry', () => {
    const workhorseDist = {
      workhorses,
      roles: {
        work: {
          model: [
            { model: 'workhorse:mid', weight: 60 },
            { model: 'workhorse:expensive', weight: 40 },
          ],
        },
      },
    } as Parameters<typeof resolveModel>[2];
    const result = resolveModel('work', undefined, workhorseDist, 'some-key');
    expect(['claude-sonnet-4-6', 'claude-opus-4-8']).toContain(result);
  });

  it('scalar role model resolves identically with or without spawnKey (back-compat)', () => {
    const scalarConfig = {
      workhorses,
      roles: { work: { model: 'claude-sonnet-4-6' } },
    } as Parameters<typeof resolveModel>[2];
    expect(resolveModel('work', undefined, scalarConfig)).toBe('claude-sonnet-4-6');
    expect(resolveModel('work', undefined, scalarConfig, 'any-key')).toBe('claude-sonnet-4-6');
  });

  it('default model resolves when no role config is set', () => {
    const result = resolveModel('plan', undefined, { workhorses });
    expect(result).toBe('claude-opus-4-8'); // workhorse:expensive
  });
});
