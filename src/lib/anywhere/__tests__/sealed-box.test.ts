/**
 * PAN-4843 W-1: sealTo seals a phone push with libsodium crypto_box_seal, so only
 * the holder of the matching secret key opens it.
 */
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import type { MachineKeyPair } from '../machine-key.js';
import { openSealed, sealTo } from '../sealed-box.js';

interface Sodium {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
}
const sodium = createRequire(import.meta.url)('sodium-native') as Sodium;

/** A fixed X25519 key pair derived from a one-byte seed fill. */
function fixedKeyPair(fill: number): MachineKeyPair {
  const publicKey = Buffer.alloc(32);
  const secretKey = Buffer.alloc(32);
  sodium.crypto_box_seed_keypair(publicKey, secretKey, Buffer.alloc(32, fill));
  return { publicKey, secretKey };
}

const MESSAGE = Buffer.from(JSON.stringify({ v: 1, title: 'Needs you', body: 'PAN-4843 asks a question' }));

describe('sealTo (PAN-4843)', () => {
  it('seals a box that openSealed opens with the same key pair, 48 bytes longer than the message', () => {
    const keys = fixedKeyPair(5);
    const sealed = sealTo(keys.publicKey, MESSAGE);
    expect(sealed.byteLength).toBe(MESSAGE.byteLength + 48);
    expect(openSealed(sealed, keys)).toEqual(MESSAGE);
  });

  it('does not open with another key pair', () => {
    const sealed = sealTo(fixedKeyPair(5).publicKey, MESSAGE);
    expect(openSealed(sealed, fixedKeyPair(6))).toBeNull();
  });

  it('throws when the public key is not 32 bytes', () => {
    expect(() => sealTo(new Uint8Array(31), MESSAGE)).toThrow('sealTo needs a 32-byte public key');
  });
});
