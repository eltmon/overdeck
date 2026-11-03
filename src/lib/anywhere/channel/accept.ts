/**
 * Responder side of a secure channel (PAN-4645 WI-2, D-4645-5).
 *
 * Transport-agnostic: the caller hands in a raw duplex (a TCP socket whose
 * first byte was `0x00`, or a `/ws/link` WebSocket stream). `acceptChannel`
 * reads the preamble, runs Noise IK (link), XXpsk0 (pairing) or XX (approval, PAN-2356), and resolves
 * with a {@link ChannelSocket} the dashboard can treat as a connection.
 *
 * Refusals (D-4645-5 step 2) are written before the connection is closed so
 * the initiator learns why. A responder that cannot decrypt an IK message 1
 * (the initiator pinned a different key) says nothing and drops the connection.
 */
import type { Duplex } from 'node:stream';

import {
  APPROVAL_NONCE_BYTES,
  approvalCommitment,
  approvalNonce,
  approvalSas,
  encodeFrame,
  encodeRefusal,
  FrameReader,
  type Handshake,
  ikResponder,
  NOISE_LINK_PROTOCOL,
  PAIRING_ID_LENGTH,
  parsePreambleHead,
  PREAMBLE_LENGTH,
  prologueFor,
  REFUSAL_CODES,
  type Refusal,
  WireError,
  xxPskResponder,
  xxResponder,
} from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';

import type { MachineKeyPair } from '../machine-key.js';
import { type ChannelMarker, type ChannelSocket, createChannelSocket } from './channel-socket.js';

export const DEFAULT_ACCEPT_TIMEOUT_MS = 10_000;

export type ChannelAcceptErrorCode =
  | 'timeout'
  | 'bad-preamble'
  | 'unsupported'
  | 'unknown-peer'
  | 'pairing-refused'
  | 'approval-refused'
  | 'handshake-failed'
  | 'closed';

export class ChannelAcceptError extends Error {
  constructor(
    readonly code: ChannelAcceptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChannelAcceptError';
  }
}

export interface PairingSecret {
  psk: Uint8Array;
  /** Called once the XXpsk0 handshake completes (the credential is spent). */
  onSuccess?: () => void;
}

export interface AcceptChannelOptions {
  localKey: MachineKeyPair;
  /** IK: is this initiator static key (64 hex) pinned here? False ⇒ refusal `01`. */
  isPinnedPeer: (remoteKeyHex: string) => boolean;
  /** XXpsk0: the PSK for a pairing id (32 hex), or `'unknown'` ⇒ refusal `03`. */
  takePairing: (pairingId: string) => PairingSecret | 'unknown';
  /** Called on every failed pairing attempt (unknown id or wrong code). */
  onPairingFailure: () => void;
  /**
   * Approval (PAN-2356 D-2356-9): accept an approval channel only for this machine's own live
   * request id, once. Absent or false ⇒ refusal `03`.
   */
  takeApproval?: (requestId: string) => boolean;
  /** Whole handshake must finish within this; default 10 s (NFR-6). */
  timeoutMs?: number;
  /** Link protocol this responder speaks; default 1. */
  linkProtocol?: number;
  /** Reported inside refusal `02`. */
  serverVersion?: string;
}

interface Closer {
  destroySoon?: () => void;
}

/** Write a refusal frame and close once it has flushed. */
export function refuseChannel(raw: Duplex, refusal: Refusal): void {
  raw.write(encodeRefusal(refusal));
  const closer = raw as Duplex & Closer;
  if (typeof closer.destroySoon === 'function') closer.destroySoon();
  else raw.end();
}

export async function acceptChannel(raw: Duplex, opts: AcceptChannelOptions): Promise<ChannelSocket> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_ACCEPT_TIMEOUT_MS;
  const linkProtocol = opts.linkProtocol ?? NOISE_LINK_PROTOCOL;
  const reader = new FrameReader(raw);
  let refused = false;
  const refuse = (code: ChannelAcceptErrorCode, refusal: Refusal, message: string): ChannelAcceptError => {
    refused = true;
    refuseChannel(raw, refusal);
    return new ChannelAcceptError(code, message);
  };
  const timer = setTimeout(() => {
    reader.fail(new ChannelAcceptError('timeout', `Secure-channel handshake did not finish within ${timeoutMs} ms`));
    raw.destroy();
  }, timeoutMs);

  try {
    const head = parsePreambleHead(await reader.readBytes(PREAMBLE_LENGTH));
    if (head.linkProtocol !== linkProtocol) {
      throw refuse(
        'unsupported',
        { code: REFUSAL_CODES.unsupported, linkProtocol, serverVersion: opts.serverVersion ?? '' },
        `Peer speaks link protocol ${head.linkProtocol}, this machine speaks ${linkProtocol}`,
      );
    }

    if (head.mode === 'link') {
      const handshake = ikResponder(opts.localKey, prologueFor('link', null));
      const message1 = await readMessage(reader);
      try {
        handshake.recv(message1);
      } catch {
        // The initiator pinned a key that is not ours: nothing useful can be said.
        throw new ChannelAcceptError('handshake-failed', 'Noise IK message 1 did not decrypt (initiator pinned another key)');
      }
      const remoteKeyHex = Buffer.from(handshake.remoteKey()).toString('hex');
      if (!opts.isPinnedPeer(remoteKeyHex)) {
        throw refuse('unknown-peer', { code: REFUSAL_CODES.unknownPeer }, `Initiator key ${remoteKeyHex.slice(0, 16)}… is not pinned here`);
      }
      const message2 = handshake.send();
      return finish(raw, reader, handshake, false, message2, { mode: 'link', remoteKeyHex, pairingId: null });
    }

    if (head.mode === 'approval') {
      const requestId = Buffer.from(await reader.readBytes(PAIRING_ID_LENGTH)).toString('hex');
      if (!opts.takeApproval?.(requestId)) {
        throw refuse('approval-refused', { code: REFUSAL_CODES.pairingRefused }, `No live approval request ${requestId}`);
      }
      const handshake = xxResponder(opts.localKey, prologueFor('approval', requestId));
      handshake.recv(await readMessage(reader));
      raw.write(encodeFrame(handshake.send()));
      const message3 = await readMessage(reader);
      try {
        handshake.recv(message3);
      } catch {
        throw new ChannelAcceptError('handshake-failed', 'Approval handshake message 3 did not verify');
      }
      const remoteKeyHex = Buffer.from(handshake.remoteKey()).toString('hex');
      // Commit-then-reveal (D-2356-10 amended): take the initiator's commitment, send our nonce,
      // and show a code only if the revealed nonce matches the commitment.
      const hash = handshake.result().hash;
      const commitment = await readMessage(reader);
      const nonce = approvalNonce(nodeCrypto);
      raw.write(encodeFrame(nonce));
      const initiatorNonce = await readMessage(reader);
      if (
        commitment.length !== 32
        || initiatorNonce.length !== APPROVAL_NONCE_BYTES
        || !nodeCrypto.timingSafeEqual(approvalCommitment(nodeCrypto, hash, initiatorNonce), commitment)
      ) {
        throw new ChannelAcceptError('handshake-failed', 'Approval nonce did not match its commitment');
      }
      const sas = approvalSas(nodeCrypto, hash, initiatorNonce, nonce);
      return finish(raw, reader, handshake, false, null, { mode: 'approval', remoteKeyHex, pairingId: null, requestId, approvalSas: sas });
    }

    const pairingId = Buffer.from(await reader.readBytes(PAIRING_ID_LENGTH)).toString('hex');
    const taken = opts.takePairing(pairingId);
    if (taken === 'unknown') {
      opts.onPairingFailure();
      throw refuse('pairing-refused', { code: REFUSAL_CODES.pairingRefused }, `Unknown or expired pairing id ${pairingId}`);
    }
    const handshake = xxPskResponder(opts.localKey, taken.psk, prologueFor('pairing', pairingId));
    const message1 = await readMessage(reader);
    try {
      handshake.recv(message1);
    } catch {
      opts.onPairingFailure();
      throw refuse('pairing-refused', { code: REFUSAL_CODES.pairingRefused }, 'Pairing code did not match');
    }
    raw.write(encodeFrame(handshake.send()));
    const message3 = await readMessage(reader);
    try {
      handshake.recv(message3);
    } catch {
      opts.onPairingFailure();
      throw refuse('pairing-refused', { code: REFUSAL_CODES.pairingRefused }, 'Pairing handshake message 3 did not verify');
    }
    const remoteKeyHex = Buffer.from(handshake.remoteKey()).toString('hex');
    taken.onSuccess?.();
    return finish(raw, reader, handshake, false, null, { mode: 'pairing', remoteKeyHex, pairingId });
  } catch (error) {
    reader.detach();
    if (!refused && !raw.destroyed) raw.destroy();
    throw toAcceptError(error);
  } finally {
    clearTimeout(timer);
  }
}

async function readMessage(reader: FrameReader): Promise<Uint8Array> {
  const frame = await reader.readFrame();
  if (frame.kind !== 'message') {
    throw new ChannelAcceptError('bad-preamble', `Initiator sent refusal code ${frame.refusal.code} instead of a handshake message`);
  }
  return frame.payload;
}

/**
 * Last handshake step: detach the reader, write the final message (if this
 * side sends one) and build the secure stream in the same tick.
 */
function finish(
  raw: Duplex,
  reader: FrameReader,
  handshake: Handshake,
  initiator: boolean,
  finalMessage: Uint8Array | null,
  channel: ChannelMarker,
): ChannelSocket {
  const leftover = reader.detach();
  if (finalMessage) raw.write(encodeFrame(finalMessage));
  return createChannelSocket({ raw, initiator, handshake: handshake.result(), channel, leftover });
}

function toAcceptError(error: unknown): ChannelAcceptError {
  if (error instanceof ChannelAcceptError) return error;
  if (error instanceof WireError) {
    if (error.code === 'closed') return new ChannelAcceptError('closed', error.message);
    return new ChannelAcceptError('bad-preamble', error.message);
  }
  return new ChannelAcceptError('closed', (error as Error)?.message ?? String(error));
}
