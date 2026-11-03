import { describe, expect, it } from 'vitest';
import { formatShareCode, normalizeShareCode, parseJoinTarget } from '../../../../src/lib/sharing/share-code.js';

describe('normalizeShareCode', () => {
  it('uppercases and strips the dash', () => {
    expect(normalizeShareCode('bcdf-ghjk')).toBe('BCDFGHJK');
  });

  it('rejects a symbol outside the alphabet', () => {
    expect(normalizeShareCode('BCDFGHJA')).toBeNull();
  });
});

describe('parseJoinTarget', () => {
  it('reads the code from a join URL', () => {
    expect(parseJoinTarget('https://share.overdeck.ai/s/BCDFGHJK')).toBe('BCDFGHJK');
  });

  it('reads a lowercase dashed code from a join URL with a trailing slash', () => {
    expect(parseJoinTarget('https://share.overdeck.ai/s/bcdf-ghjk/')).toBe('BCDFGHJK');
  });

  it('rejects a target longer than 2,048 characters', () => {
    expect(parseJoinTarget('x'.repeat(2049))).toBeNull();
  });

  it('rejects a non-string target', () => {
    expect(parseJoinTarget(42)).toBeNull();
  });
});

describe('formatShareCode', () => {
  it('splits an 8-character code with a dash', () => {
    expect(formatShareCode('BCDFGHJK')).toBe('BCDF-GHJK');
  });
});
