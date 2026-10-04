import { describe, expect, it } from 'vitest';

import { toWellFormedText, truncateWellFormed } from '../well-formed-text.js';

describe('toWellFormedText', () => {
  it('replaces a lone high surrogate with the replacement character', () => {
    expect(toWellFormedText('a\uD83Eb')).toBe('a�b');
  });

  it('leaves well-formed text with a valid surrogate pair unchanged', () => {
    expect(toWellFormedText('ok 🛠️')).toBe('ok 🛠️');
  });
});

describe('truncateWellFormed', () => {
  it('drops a trailing high surrogate left dangling by the slice', () => {
    const text = 'x'.repeat(199) + '🛠rest';
    const result = truncateWellFormed(text, 200);
    expect(result).toHaveLength(199);
    const lastCode = result.charCodeAt(result.length - 1);
    expect(lastCode).toBeLessThan(0xd800);
  });

  it('preserves a whole emoji that lands exactly on the boundary', () => {
    const text = 'x'.repeat(198) + '🛠rest';
    const result = truncateWellFormed(text, 200);
    expect(result).toHaveLength(200);
    expect(result).toBe('x'.repeat(198) + '🛠');
  });
});
