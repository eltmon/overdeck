/**
 * Sealed boxes through libsodium: opens directory inbox events sealed to this machine's key
 * (PRD PAN-2356 D-2356-16) and seals phone pushes to each phone's public key (PAN-4843).
 *
 * The connect Worker seals each webhook event with a pure-JavaScript `crypto_box_seal`
 * (services/connect/src/seal.ts). The machine opens it with libsodium's reference
 * `crypto_box_seal_open` and seals phone pushes with `crypto_box_seal`, both through
 * sodium-native, loaded with createRequire like the Noise stack.
 */
import { createRequire } from 'node:module';
import type { MachineKeyPair } from './machine-key.js';

interface SodiumSeal {
  crypto_box_SEALBYTES: number;
  crypto_box_PUBLICKEYBYTES: number;
  crypto_box_seal(c: Uint8Array, m: Uint8Array, pk: Uint8Array): void;
  crypto_box_seal_open(m: Uint8Array, c: Uint8Array, pk: Uint8Array, sk: Uint8Array): boolean;
}

const _require = createRequire(import.meta.url);
const sodium = _require('sodium-native') as SodiumSeal;

/** The plaintext, or null when the box is malformed, truncated, tampered with or sealed to another key. */
export function openSealed(sealed: Buffer, keyPair: MachineKeyPair): Buffer | null {
  if (sealed.byteLength < sodium.crypto_box_SEALBYTES) return null;
  const out = Buffer.alloc(sealed.byteLength - sodium.crypto_box_SEALBYTES);
  try {
    return sodium.crypto_box_seal_open(out, sealed, keyPair.publicKey, keyPair.secretKey) ? out : null;
  } catch {
    return null;
  }
}

/** `crypto_box_seal` of `message` to an X25519 public key: 48 bytes longer than the message (PAN-4843). */
export function sealTo(recipientPublicKey: Uint8Array, message: Uint8Array): Buffer {
  if (recipientPublicKey.byteLength !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('sealTo needs a 32-byte public key');
  const out = Buffer.alloc(message.byteLength + sodium.crypto_box_SEALBYTES);
  sodium.crypto_box_seal(out, message, recipientPublicKey);
  return out;
}
