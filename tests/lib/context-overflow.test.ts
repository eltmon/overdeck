import { describe, expect, it } from 'vitest';

import { isContextOverflowTail } from '../../src/lib/context-overflow.js';

const OVERFLOW_LINE = 'API Error: 400 Your input exceeds the context window of this model.';

describe('isContextOverflowTail', () => {
  it('returns true for hard context-window overflow text in the recent tail', () => {
    expect(isContextOverflowTail(['working...', OVERFLOW_LINE, '❯ '].join('\n'))).toBe(true);
    expect(isContextOverflowTail('API Error: 400 exceeds the context window of this model.')).toBe(true);
  });

  it('returns false when a benign context-window mention is outside the recent tail', () => {
    const output = [
      'operator note: input exceeds the context window',
      ...Array.from({ length: 40 }, (_, i) => `recent line ${i}`),
    ].join('\n');

    expect(isContextOverflowTail(output)).toBe(false);
  });

  it('returns false for an empty tail', () => {
    expect(isContextOverflowTail('')).toBe(false);
  });
});
