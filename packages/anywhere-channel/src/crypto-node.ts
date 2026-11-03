/** The Node crypto port, backed by `node:crypto`. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { CryptoPort } from './crypto-port.js';

export const nodeCrypto: CryptoPort = {
  sha256: (data) => createHash('sha256').update(data).digest(),
  randomBytes: (n) => randomBytes(n),
  timingSafeEqual: (a, b) => a.length === b.length && timingSafeEqual(a, b),
};
