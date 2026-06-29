import { describe, expect, it } from 'vitest';

import {
  buildCompactRecoverySeedMessage,
  isContextOverflowError,
  isContextOverflowTail,
} from '../../src/lib/context-overflow.js';

const OVERFLOW_LINE = 'API Error: 400 Your input exceeds the context window of this model.';

describe('buildCompactRecoverySeedMessage', () => {
  it('points only at durable recovery artifacts and warns not to restart', () => {
    const message = buildCompactRecoverySeedMessage('PAN-TEST', null);

    expect(message).toContain('PAN-TEST');
    expect(message).toContain('.pan/continue.json');
    expect(message).toContain('bd ready');
    expect(message).toContain('bd show <id>');
    expect(message).toContain('git status');
    expect(message).toContain('git diff');
    expect(message).toMatch(/Do NOT start over/);
    expect(message).toMatch(/fresh session/i);
    expect(message).toMatch(/context-window/i);
  });
});

describe('isContextOverflowTail', () => {
  it('returns true for hard context-window overflow text in the recent tail', () => {
    expect(isContextOverflowTail(['working...', OVERFLOW_LINE, '❯ '].join('\n'))).toBe(true);
    expect(isContextOverflowTail('API Error: 400 exceeds the context window of this model.')).toBe(true);
  });

  it('returns true for kimi-native model token limit overflow text', () => {
    const message = 'API Error: 400 Invalid request: Your request exceeded model token limit: 262144 (requested: 336148)';

    expect(isContextOverflowTail(message)).toBe(true);
    expect(isContextOverflowError(new Error(message))).toBe(true);
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
