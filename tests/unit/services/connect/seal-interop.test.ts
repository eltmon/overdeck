import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SEAL_OVERHEAD_BYTES, sealTo } from '../../../../services/connect/src/seal.ts';
import { openSealed } from '../../../../src/lib/anywhere/sealed-box.ts';
import type { MachineKeyPair } from '../../../../src/lib/anywhere/machine-key.ts';

interface Sodium {
  crypto_box_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
  crypto_box_seal(c: Buffer, m: Buffer, pk: Buffer): void;
}
const sodium = createRequire(import.meta.url)('sodium-native') as Sodium;

/** A fixed 32-byte X25519 key pair (the machine key is an X25519 key pair). */
function fixedKeyPair(fill: number): MachineKeyPair {
  const publicKey = Buffer.alloc(32);
  const secretKey = Buffer.alloc(32);
  sodium.crypto_box_seed_keypair(publicKey, secretKey, Buffer.alloc(32, fill));
  return { publicKey, secretKey };
}

const MESSAGE = Buffer.from(JSON.stringify({ v: 1, eventId: 'e-1', body: Buffer.from('{"hello":"world"}').toString('base64') }));

describe('sealed box interop (PAN-2356 WI-4)', () => {
  it('opens on the machine what the Worker sealed, and adds exactly 48 bytes', () => {
    const keys = fixedKeyPair(7);
    const sealed = sealTo(keys.publicKey, MESSAGE);
    expect(sealed.byteLength).toBe(MESSAGE.byteLength + SEAL_OVERHEAD_BYTES);
    expect(openSealed(Buffer.from(sealed), keys)).toEqual(MESSAGE);
  });

  it('returns null for one flipped byte, a truncated box, or another key, and never throws', () => {
    const keys = fixedKeyPair(7);
    const sealed = Buffer.from(sealTo(keys.publicKey, MESSAGE));
    for (const index of [0, 31, 32, 47, sealed.byteLength - 1]) {
      const flipped = Buffer.from(sealed);
      flipped[index] = (flipped[index] as number) ^ 0x01;
      expect(openSealed(flipped, keys)).toBeNull();
    }
    expect(openSealed(sealed.subarray(0, 47), keys)).toBeNull();
    expect(openSealed(Buffer.alloc(0), keys)).toBeNull();
    expect(openSealed(sealed, fixedKeyPair(8))).toBeNull();
  });

  it('opens a box sealed by libsodium crypto_box_seal, so both sides share one format', () => {
    const keys = fixedKeyPair(9);
    const sealed = Buffer.alloc(MESSAGE.byteLength + SEAL_OVERHEAD_BYTES);
    sodium.crypto_box_seal(sealed, MESSAGE, keys.publicKey);
    expect(openSealed(sealed, keys)).toEqual(MESSAGE);
  });

  it('seals the empty message', () => {
    const keys = fixedKeyPair(3);
    const sealed = sealTo(keys.publicKey, new Uint8Array(0));
    expect(sealed.byteLength).toBe(SEAL_OVERHEAD_BYTES);
    expect(openSealed(Buffer.from(sealed), keys)).toEqual(Buffer.alloc(0));
  });
});
