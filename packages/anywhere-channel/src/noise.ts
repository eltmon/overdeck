/// <reference path="./types/noise-handshake.d.ts" />
/**
 * Noise handshakes for secure channels (PAN-4645 D-4645-1, D-4645-17).
 *
 * Thin typed wrapper over `noise-handshake` (Holepunch) with its default
 * X25519 / ChaChaPoly / BLAKE2b suite:
 *
 *  - `Noise_IK`: the initiator already knows the responder's static key
 *    (pinned machine key) and reveals its own in message 1.
 *  - `Noise_XXpsk0`: pairing. Neither side knows the other's static key; the
 *    pre-shared key derived from the one-time pairing code authenticates the
 *    exchange, and each side learns the other's key during the handshake.
 *  - `Noise_XX`: approval (PAN-2356 D-2356-9). No pre-shared secret: each side
 *    learns the other's key, and the operators authenticate the exchange by
 *    comparing a six-digit SAS on both screens. The SAS mixes the handshake hash
 *    with two nonces exchanged by commit-then-reveal after the handshake
 *    ({@link approvalCommitment}, {@link approvalSas}), so a man in the middle
 *    cannot grind one leg's code to match the other's.
 *
 * Nothing is hand-rolled on raw primitives; this module only drives the
 * library and copies its outputs. The static key pair is never zeroed by the
 * library (only ephemerals are), so the long-term machine key can be passed in.
 */
import b4a from 'b4a';
import Noise, { type NoiseState } from 'noise-handshake';
import dh from 'noise-handshake/dh.js';

import type { CryptoPort } from './crypto-port.js';
import { MODE_BYTES, type ChannelMode } from './wire.js';

/** Link protocol version this module speaks; mirrors `LINK_PROTOCOL_VERSION` in `@overdeck/contracts`. */
export const NOISE_LINK_PROTOCOL = 1;

/** A Noise static key pair. The server's `MachineKeyPair` is assignable to it. */
export interface StaticKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** A fresh X25519 static key pair from the same libsodium the handshake uses (the phone's per-machine link key, PAN-4837 C-1). */
export function generateStaticKeyPair(): StaticKeyPair {
  const { publicKey, secretKey } = dh.generateKeyPair();
  return { publicKey, secretKey };
}

/** Keys both ends hold once a handshake completes. */
export interface HandshakeResult {
  tx: Uint8Array;
  rx: Uint8Array;
  hash: Uint8Array;
  localPublicKey: Uint8Array;
  remotePublicKey: Uint8Array;
}

export class Handshake {
  constructor(
    private readonly state: NoiseState,
    private readonly localPublicKey: Uint8Array,
  ) {}

  get complete(): boolean {
    return this.state.complete;
  }

  send(payload?: Uint8Array): Uint8Array {
    return b4a.from(this.state.send(payload));
  }

  recv(message: Uint8Array): Uint8Array {
    return b4a.from(this.state.recv(message));
  }

  /** The peer's static key once learned (a copy; the library's view is a message subarray). */
  remoteKey(): Uint8Array {
    if (!this.state.rs) throw new Error('Noise handshake has not learned the remote static key yet');
    return b4a.from(this.state.rs);
  }

  /** Copies of the split keys; only valid once `complete`. */
  result(): HandshakeResult {
    if (!this.state.complete || !this.state.tx || !this.state.rx || !this.state.hash) {
      throw new Error('Noise handshake is not complete');
    }
    return {
      tx: b4a.from(this.state.tx),
      rx: b4a.from(this.state.rx),
      hash: b4a.from(this.state.hash),
      localPublicKey: b4a.from(this.localPublicKey),
      remotePublicKey: this.remoteKey(),
    };
  }
}

/**
 * The Noise prologue both ends must agree on:
 * `overdeck-link/<protocol>\0<mode byte>\0<pairing id or approval request id hex, or empty>`.
 */
export function prologueFor(mode: ChannelMode, pairingId: string | null): Uint8Array {
  return b4a.concat([
    b4a.from(`overdeck-link/${NOISE_LINK_PROTOCOL}`, 'utf8'),
    b4a.from([0, MODE_BYTES[mode], 0]),
    b4a.from(mode === 'link' ? '' : pairingId ?? '', 'utf8'),
  ]);
}

/** Length of each approval nonce in bytes. */
export const APPROVAL_NONCE_BYTES = 32;

/** A fresh approval nonce. */
export function approvalNonce(crypto: CryptoPort): Uint8Array {
  return crypto.randomBytes(APPROVAL_NONCE_BYTES);
}

/**
 * The initiator's commitment to its approval nonce (D-2356-10, amended after review):
 * `SHA-256("overdeck-approve-commit/1" || 0x00 || handshakeHash || initiatorNonce)`.
 *
 * After Noise XX completes, the initiator sends this commitment, the responder answers with its
 * own nonce, and only then does the initiator reveal its nonce, which the responder checks against
 * the commitment. A man in the middle is the responder on one leg and the initiator on the other:
 * on the first it must send its nonce before the honest initiator reveals, and on the second it
 * must commit before the honest responder's nonce arrives. Either way it fixes its input before it
 * can know the code that input yields, so it cannot steer one leg's code to match the other's.
 */
export function approvalCommitment(crypto: CryptoPort, handshakeHash: Uint8Array, initiatorNonce: Uint8Array): Uint8Array {
  return crypto.sha256(b4a.concat([b4a.from('overdeck-approve-commit/1', 'utf8'), b4a.from([0]), handshakeHash, initiatorNonce]));
}

/**
 * The six-digit short authentication string of an approval channel (D-2356-10, amended):
 * `uint32BE(SHA-256("overdeck-approve-sas/2" || 0x00 || handshakeHash || initiatorNonce || responderNonce)[0..4]) mod 1_000_000`,
 * zero-padded and shown as `123 456`. Computed only after the initiator's reveal matched its
 * commitment ({@link approvalCommitment}).
 */
export function approvalSas(
  crypto: CryptoPort,
  handshakeHash: Uint8Array,
  initiatorNonce: Uint8Array,
  responderNonce: Uint8Array,
): string {
  const digest = crypto.sha256(
    b4a.concat([b4a.from('overdeck-approve-sas/2', 'utf8'), b4a.from([0]), handshakeHash, initiatorNonce, responderNonce]),
  );
  const first = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  const code = (first % 1_000_000).toString().padStart(6, '0');
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** PSK and pairing id derived from a pairing code (D-4645-17). */
export function pairingSecrets(crypto: CryptoPort, code: string): { psk: Uint8Array; pairingId: string } {
  const psk = crypto.sha256(b4a.concat([b4a.from('overdeck-pair-psk/1', 'utf8'), b4a.from([0]), b4a.from(code, 'utf8')]));
  const id = crypto.sha256(b4a.concat([b4a.from('overdeck-pair-id/1', 'utf8'), b4a.from([0]), b4a.from(code, 'utf8')]));
  return { psk, pairingId: b4a.toString(id.subarray(0, 16), 'hex') };
}

export function ikInitiator(localKey: StaticKeyPair, remoteKey: Uint8Array, prologue: Uint8Array): Handshake {
  const state = new Noise('IK', true, localKey);
  state.initialise(prologue, remoteKey);
  return new Handshake(state, localKey.publicKey);
}

export function ikResponder(localKey: StaticKeyPair, prologue: Uint8Array): Handshake {
  const state = new Noise('IK', false, localKey);
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxPskInitiator(localKey: StaticKeyPair, psk: Uint8Array, prologue: Uint8Array): Handshake {
  const state = new Noise('XXpsk0', true, localKey, { psk });
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxInitiator(localKey: StaticKeyPair, prologue: Uint8Array): Handshake {
  const state = new Noise('XX', true, localKey);
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxResponder(localKey: StaticKeyPair, prologue: Uint8Array): Handshake {
  const state = new Noise('XX', false, localKey);
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxPskResponder(localKey: StaticKeyPair, psk: Uint8Array, prologue: Uint8Array): Handshake {
  const state = new Noise('XXpsk0', false, localKey, { psk });
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}
