/** PAN-4833 WI-2: both crypto ports agree on SHA-256 and honor the port contract. */
import { describe, expect, it } from 'vitest';

import { nodeCrypto } from '../crypto-node.js';
import type { CryptoPort } from '../crypto-port.js';
import { webCrypto } from '../crypto-web.js';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe.each<[string, CryptoPort]>([
  ['node', nodeCrypto],
  ['web', webCrypto],
])('%s crypto port', (_name, port) => {
  it('hashes abc to the SHA-256 test vector', () => {
    expect(hex(port.sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('draws random bytes beyond the 64 KiB getRandomValues limit', () => {
    const a = port.randomBytes(70_000);
    const b = port.randomBytes(70_000);
    expect(a.length).toBe(70_000);
    expect(hex(a)).not.toBe(hex(b));
  });

  it('compares in constant time and refuses length mismatches', () => {
    expect(port.timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(port.timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(port.timingSafeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2))).toBe(false);
  });
});
