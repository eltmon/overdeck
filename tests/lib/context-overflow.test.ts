import { describe, expect, it } from 'vitest';

import { buildCompactRecoverySeedMessage, isContextOverflowError, isContextOverflowTail } from '../../src/lib/context-overflow.js';

const OVERFLOW_LINE = 'API Error: 400 Your input exceeds the context window of this model.';

const CLAUDE_P_OVERFLOW = JSON.stringify({
  result: 'Prompt is too long',
  terminal_reason: 'blocking_limit',
  count: 199_999,
});

describe('isContextOverflowError', () => {
  it('returns true for the claude -p blocking-limit envelope', () => {
    expect(isContextOverflowError(new Error(CLAUDE_P_OVERFLOW))).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isContextOverflowError(new Error('PROMPT IS TOO LONG'))).toBe(true);
    expect(isContextOverflowError(new Error('terminal_reason: BLOCKING_LIMIT'))).toBe(true);
  });

  it('returns true for the existing context-window phrasing', () => {
    expect(isContextOverflowError(new Error(OVERFLOW_LINE))).toBe(true);
    expect(isContextOverflowError(OVERFLOW_LINE)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isContextOverflowError(new Error('ENOENT: no such file or directory'))).toBe(false);
    expect(isContextOverflowError(new Error('Network timeout'))).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
  });
});

describe('buildCompactRecoverySeedMessage', () => {
  it('points at the archived summary and durable recovery artifacts', () => {
    const message = buildCompactRecoverySeedMessage('PAN-1781', 'Archived summary text.');

    expect(message).toContain('PAN-1781');
    expect(message).toContain('Archived summary text.');
    expect(message).toContain('.pan/continue.json');
    expect(message).toContain('bd ready');
    expect(message).toContain('bd show <id>');
    expect(message).toContain('git status');
    expect(message).toContain('git diff');
    expect(message).toMatch(/Do NOT start over/);
    expect(message).toMatch(/starting a fresh session/i);
    expect(message).toMatch(/context-window limit/i);
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
