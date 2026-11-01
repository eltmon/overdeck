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
 *
 * Nothing is hand-rolled on raw primitives; this module only drives the
 * library and copies its outputs. The static key pair is never zeroed by the
 * library (only ephemerals are), so the long-term machine key can be passed in.
 */
import { createHash } from 'node:crypto';
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
    pattern: 'IK' | 'XXpsk0',
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
 * `overdeck-link/<protocol>\0<mode byte>\0<pairing id hex or empty>`.
 */
export function prologueFor(mode: ChannelMode, pairingId: string | null): Buffer {
  return Buffer.concat([
    Buffer.from(`overdeck-link/${NOISE_LINK_PROTOCOL}`, 'utf8'),
    Buffer.from([0, MODE_BYTES[mode], 0]),
    Buffer.from(mode === 'pairing' ? pairingId ?? '' : '', 'utf8'),
  ]);
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

export function xxPskResponder(localKey: MachineKeyPair, psk: Buffer, prologue: Buffer): Handshake {
  const state = new Noise('XXpsk0', false, localKey, { psk });
  state.initialise(prologue);
  return new Handshake(state, localKey.publicKey);
}
