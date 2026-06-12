import { describe, expect, it } from 'vitest';

import { buildCompactRecoverySeedMessage, isContextOverflowTail } from '../../src/lib/context-overflow.js';

const OVERFLOW_LINE = 'API Error: 400 Your input exceeds the context window of this model.';

describe('buildCompactRecoverySeedMessage', () => {
  it('embeds a compact recovery summary while pointing at durable artifacts', () => {
    const message = buildCompactRecoverySeedMessage('PAN-1781', 'Recovered the deacon compact-respawn path.');

    expect(message).toContain('Your previous session for PAN-1781 hit the model');
    expect(message).toContain('Summary of the archived session:');
    expect(message).toContain('Recovered the deacon compact-respawn path.');
    expect(message).toContain('.pan/continue.json');
    expect(message).toContain('bd ready');
    expect(message).toContain('bd show <id>');
    expect(message).toContain('git status');
    expect(message).toContain('git diff');
    expect(message).toMatch(/Do NOT start over/);
    expect(message).toMatch(/context-window/i);
  });

  it('falls back to durable artifacts when no summary is available', () => {
    const message = buildCompactRecoverySeedMessage('PAN-1781', null);

    expect(message).not.toContain('Summary of the archived session:');
    expect(message).toContain('Read .pan/continue.json');
    expect(message).toContain('Inspect `git status` and `git diff`');
    expect(message).toContain('do not wait for further instructions');
  });
});

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
