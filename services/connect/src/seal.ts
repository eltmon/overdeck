/**
 * libsodium sealed boxes (`crypto_box_seal`) in pure JavaScript, for the webhook inbox (PRD PAN-2356
 * D-2356-15, D-2356-16). The Worker seals each event to the owning machine's X25519 public key; the
 * machine opens it with sodium-native's `crypto_box_seal_open` (src/lib/anywhere/sealed-box.ts).
 *
 * Format: `ephemeralPublicKey (32) || XSalsa20-Poly1305(message)`, with
 * nonce = BLAKE2b-192(ephemeralPublicKey || recipientPublicKey) and the NaCl box key
 * HSalsa20(X25519(ephemeralSecretKey, recipientPublicKey), 0). Overhead: 48 bytes.
 * The ephemeral secret key exists only inside one call.
 */
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';

export const SEAL_OVERHEAD_BYTES = 48;

/** "expand 32-byte k" as four little-endian 32-bit words. */
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function wordsLE(bytes: Uint8Array): Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

function bytesLE(words: Uint32Array): Uint8Array {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i] as number, true);
  return out;
}

/** NaCl `crypto_box_beforenm`: HSalsa20 of the X25519 shared secret with a zero nonce. */
function boxKey(sharedSecret: Uint8Array): Uint8Array {
  const out = new Uint32Array(8);
  hsalsa(SIGMA, wordsLE(sharedSecret), new Uint32Array(4), out);
  return bytesLE(out);
}

export function sealTo(recipientPublicKey: Uint8Array, message: Uint8Array): Uint8Array {
  if (recipientPublicKey.byteLength !== 32) throw new Error('recipient public key must be 32 bytes');
  const ephemeralSecretKey = x25519.utils.randomSecretKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey);
  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeralPublicKey, 0);
  nonceInput.set(recipientPublicKey, 32);
  const nonce = blake2b(nonceInput, { dkLen: 24 });
  const key = boxKey(x25519.getSharedSecret(ephemeralSecretKey, recipientPublicKey));
  const ciphertext = xsalsa20poly1305(key, nonce).encrypt(message);
  ephemeralSecretKey.fill(0);
  key.fill(0);
  const sealed = new Uint8Array(32 + ciphertext.byteLength);
  sealed.set(ephemeralPublicKey, 0);
  sealed.set(ciphertext, 32);
  return sealed;
}
