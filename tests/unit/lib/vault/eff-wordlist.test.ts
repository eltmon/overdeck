import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { EFF_LONG_WORDS } from '../../../../src/lib/vault/eff-wordlist.js';

const UPSTREAM_SHA256 = 'addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e';

/** The upstream dice index of entry `i`: base 6 with digits 1-6, five characters. */
function diceIndex(i: number): string {
  return i.toString(6).padStart(5, '0').replace(/[0-5]/g, (digit) => String(Number(digit) + 1));
}

describe('EFF long wordlist', () => {
  it('has 7776 unique lowercase words from abacus to zoom', () => {
    expect(EFF_LONG_WORDS).toHaveLength(7776);
    expect(new Set(EFF_LONG_WORDS).size).toBe(7776);
    for (const word of EFF_LONG_WORDS) expect(word).toMatch(/^[a-z-]+$/);
    expect(EFF_LONG_WORDS[0]).toBe('abacus');
    expect(EFF_LONG_WORDS[7775]).toBe('zoom');
  });

  it('rebuilds a file byte-identical to upstream eff_large_wordlist.txt', () => {
    expect(diceIndex(0)).toBe('11111');
    expect(diceIndex(7775)).toBe('66666');
    const text = EFF_LONG_WORDS.map((word, i) => `${diceIndex(i)}\t${word}\n`).join('');
    expect(createHash('sha256').update(text).digest('hex')).toBe(UPSTREAM_SHA256);
  });
});
