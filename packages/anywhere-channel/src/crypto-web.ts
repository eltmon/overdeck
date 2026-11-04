/** The web crypto port: `@noble/hashes` SHA-256 and `crypto.getRandomValues`. */
import { sha256 } from '@noble/hashes/sha2.js';

import type { CryptoPort } from './crypto-port.js';

/** `getRandomValues` refuses requests above 65,536 bytes. */
const MAX_RANDOM_CHUNK = 65_536;

export const webCrypto: CryptoPort = {
  sha256: (data) => sha256(data),
  randomBytes: (n) => {
    const out = new Uint8Array(n);
    for (let offset = 0; offset < n; offset += MAX_RANDOM_CHUNK) {
      globalThis.crypto.getRandomValues(out.subarray(offset, Math.min(offset + MAX_RANDOM_CHUNK, n)));
    }
    return out;
  },
  timingSafeEqual: (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    return diff === 0;
  },
};
