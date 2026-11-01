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
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import type { MachineKeyPair } from '../machine-key.js';
import { MODE_BYTES, type ChannelMode } from './wire.js';

/** Link protocol version this module speaks; mirrors `LINK_PROTOCOL_VERSION` in `@overdeck/contracts`. */
export const NOISE_LINK_PROTOCOL = 1;

interface NoiseState {
  initialise(prologue: Uint8Array, remoteStatic?: Uint8Array): void;
  send(payload?: Uint8Array): Uint8Array;
  recv(message: Uint8Array): Uint8Array;
  complete: boolean;
  rs: Uint8Array | null;
  tx: Uint8Array | null;
  rx: Uint8Array | null;
  hash: Uint8Array | null;
}

interface NoiseConstructor {
  new (
    pattern: 'IK' | 'XX' | 'XXpsk0',
    initiator: boolean,
    staticKeyPair: MachineKeyPair,
    opts?: { psk?: Uint8Array },
  ): NoiseState;
}

const _require = createRequire(import.meta.url);
const Noise = _require('noise-handshake') as NoiseConstructor;

/** Keys both ends hold once a handshake completes. */
export interface HandshakeResult {
  tx: Buffer;
  rx: Buffer;
  hash: Buffer;
  localPublicKey: Buffer;
  remotePublicKey: Buffer;
}

export class Handshake {
  constructor(
    private readonly state: NoiseState,
    private readonly localPublicKey: Buffer,
  ) {}

  get complete(): boolean {
    return this.state.complete;
  }

  send(payload?: Uint8Array): Buffer {
    return Buffer.from(this.state.send(payload));
  }

  recv(message: Uint8Array): Buffer {
    return Buffer.from(this.state.recv(message));
  }

  /** The peer's static key once learned (a copy; the library's view is a message subarray). */
  remoteKey(): Buffer {
    if (!this.state.rs) throw new Error('Noise handshake has not learned the remote static key yet');
    return Buffer.from(this.state.rs);
  }

  /** Copies of the split keys; only valid once `complete`. */
  result(): HandshakeResult {
    if (!this.state.complete || !this.state.tx || !this.state.rx || !this.state.hash) {
      throw new Error('Noise handshake is not complete');
    }
    return {
      tx: Buffer.from(this.state.tx),
      rx: Buffer.from(this.state.rx),
      hash: Buffer.from(this.state.hash),
      localPublicKey: Buffer.from(this.localPublicKey),
      remotePublicKey: this.remoteKey(),
    };
  }
}

/**
 * The Noise prologue both ends must agree on:
 * `overdeck-link/<protocol>\0<mode byte>\0<pairing id or approval request id hex, or empty>`.
 */
export function prologueFor(mode: ChannelMode, pairingId: string | null): Buffer {
  return Buffer.concat([
    Buffer.from(`overdeck-link/${NOISE_LINK_PROTOCOL}`, 'utf8'),
    Buffer.from([0, MODE_BYTES[mode], 0]),
    Buffer.from(mode === 'link' ? '' : pairingId ?? '', 'utf8'),
  ]);
}

/** Length of each approval nonce in bytes. */
export const APPROVAL_NONCE_BYTES = 32;

/** A fresh approval nonce. */
export function approvalNonce(): Buffer {
  return randomBytes(APPROVAL_NONCE_BYTES);
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
export function approvalCommitment(handshakeHash: Buffer, initiatorNonce: Buffer): Buffer {
  return createHash('sha256')
    .update('overdeck-approve-commit/1')
    .update(Buffer.from([0]))
    .update(handshakeHash)
    .update(initiatorNonce)
    .digest();
}

/**
 * The six-digit short authentication string of an approval channel (D-2356-10, amended):
 * `uint32BE(SHA-256("overdeck-approve-sas/2" || 0x00 || handshakeHash || initiatorNonce || responderNonce)[0..4]) mod 1_000_000`,
 * zero-padded and shown as `123 456`. Computed only after the initiator's reveal matched its
 * commitment ({@link approvalCommitment}).
 */
export function approvalSas(handshakeHash: Buffer, initiatorNonce: Buffer, responderNonce: Buffer): string {
  const digest = createHash('sha256')
    .update('overdeck-approve-sas/2')
    .update(Buffer.from([0]))
    .update(handshakeHash)
    .update(initiatorNonce)
    .update(responderNonce)
    .digest();
  const code = (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** PSK and pairing id derived from a pairing code (D-4645-17). */
export function pairingSecrets(code: string): { psk: Buffer; pairingId: string } {
  const psk = createHash('sha256').update('overdeck-pair-psk/1').update(Buffer.from([0])).update(code, 'utf8').digest();
  const pairingId = createHash('sha256')
    .update('overdeck-pair-id/1')
    .update(Buffer.from([0]))
    .update(code, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('hex');
  return { psk, pairingId };
}

export function ikInitiator(localKey: MachineKeyPair, remoteKey: Buffer, prologue: Buffer): Handshake {
  const state = new Noise('IK', true, localKey);
  state.initialise(prologue, remoteKey);
  return new Handshake(state, localKey.publicKey);
}

export function ikResponder(localKey: MachineKeyPair, prologue: Buffer): Handshake {
  const state = new Noise('IK', false, localKey);
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxPskInitiator(localKey: MachineKeyPair, psk: Buffer, prologue: Buffer): Handshake {
  const state = new Noise('XXpsk0', true, localKey, { psk });
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxInitiator(localKey: MachineKeyPair, prologue: Buffer): Handshake {
  const state = new Noise('XX', true, localKey);
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxResponder(localKey: MachineKeyPair, prologue: Buffer): Handshake {
  const state = new Noise('XX', false, localKey);
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}

export function xxPskResponder(localKey: MachineKeyPair, psk: Buffer, prologue: Buffer): Handshake {
  const state = new Noise('XXpsk0', false, localKey, { psk });
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}
