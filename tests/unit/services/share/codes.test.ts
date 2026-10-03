import { describe, expect, it } from 'vitest';
import {
  newHostToken,
  newShortCode,
  normalizeShortCode,
  sha256Hex,
  SHORT_CODE_ALPHABET,
  timingSafeEqualHex,
} from '../../../../services/share/src/codes.ts';

/** randomBytes that replays `bytes` in order, cycling. */
function replay(bytes: number[]) {
  let i = 0;
  return { randomBytes: (n: number) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length] as number) };
}

describe('share codes (PAN-658 share-rooms-http)', () => {
  it('the alphabet has 28 symbols with no vowels and no 0/O/1/I', () => {
    expect(SHORT_CODE_ALPHABET).toHaveLength(28);
    expect(SHORT_CODE_ALPHABET).not.toMatch(/[AEIOU01]/);
    expect(new Set(SHORT_CODE_ALPHABET).size).toBe(28);
  });

  it('newShortCode returns 8 alphabet-only symbols', () => {
    const deps = { randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };
    for (let i = 0; i < 200; i++) {
      const code = newShortCode(deps);
      expect(code).toMatch(new RegExp(`^[${SHORT_CODE_ALPHABET}]{8}$`));
    }
  });

  it('rejection sampling discards bytes >= 252 and maps the rest modulo 28', () => {
    const code = newShortCode(replay([252, 253, 254, 255, 0, 27, 28, 251, 1, 2, 3, 4]));
    expect(code).toBe(
      [0, 27, 0, 27, 1, 2, 3, 4].map((i) => SHORT_CODE_ALPHABET[i]).join(''),
    );
  });

  it('newShortCode keeps drawing when a whole batch is rejected', () => {
    let calls = 0;
    const deps = {
      randomBytes: (n: number) => {
        calls++;
        return new Uint8Array(n).fill(calls === 1 ? 255 : 5);
      },
    };
    expect(newShortCode(deps)).toBe((SHORT_CODE_ALPHABET[5] as string).repeat(8));
    expect(calls).toBe(2);
  });

  it('normalizeShortCode uppercases and strips spaces and dashes', () => {
    expect(normalizeShortCode('bcdf-ghjk')).toBe('BCDFGHJK');
    expect(normalizeShortCode(' BCDF GHJK ')).toBe('BCDFGHJK');
    expect(normalizeShortCode('23-45-67-89')).toBe('23456789');
  });

  it('normalizeShortCode rejects wrong lengths and symbols outside the alphabet', () => {
    expect(normalizeShortCode('BCDFGHJ')).toBeNull();
    expect(normalizeShortCode('BCDFGHJKL')).toBeNull();
    expect(normalizeShortCode('BCDFGHJA')).toBeNull();
    expect(normalizeShortCode('BCDFGHJ0')).toBeNull();
    expect(normalizeShortCode('BCDF/GHJ')).toBeNull();
    expect(normalizeShortCode('')).toBeNull();
  });

  it('newHostToken is odh_ followed by 64 lowercase hex', () => {
    expect(newHostToken(replay([0xab]))).toBe('odh_' + 'ab'.repeat(32));
    expect(newHostToken({ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) })).toMatch(/^odh_[0-9a-f]{64}$/);
  });

  it('sha256Hex matches the known SHA-256 of "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('timingSafeEqualHex compares equal-length strings and rejects different lengths', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true);
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(true);
  });
});
