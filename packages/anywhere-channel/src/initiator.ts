/**
 * Initiator side of a secure channel (PAN-4645 WI-2, D-4645-5; moved here by PAN-4833 D-6).
 *
 * The transport-agnostic handshake sequence the server's `openChannel` and the
 * phone's `openSecureChannel` share: write the preamble, run Noise IK (link),
 * XXpsk0 (pairing) or XX (approval, with commit-then-reveal), map refusals to
 * {@link ChannelOpenError}, and hand the result to a synchronous finisher that
 * builds the secure stream in the same tick as the last handshake frame.
 *
 * Timeouts use `AbortController` + `setTimeout`, never `AbortSignal.timeout`
 * (it ignores fake timers under happy-dom).
 */
import b4a from 'b4a';

import type { CryptoPort } from './crypto-port.js';
import {
  APPROVAL_NONCE_BYTES,
  approvalCommitment,
  approvalNonce,
  approvalSas,
  type HandshakeResult,
  ikInitiator,
  NOISE_LINK_PROTOCOL,
  pairingSecrets,
  prologueFor,
  type StaticKeyPair,
  xxInitiator,
  xxPskInitiator,
} from './noise.js';
import {
  type ChannelMode,
  encodeFrame,
  encodePreamble,
  FrameReader,
  type RawDuplex,
  type Refusal,
  REFUSAL_CODES,
  WireError,
} from './wire.js';

export const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

export type ChannelOpenErrorCode =
  | 'unreachable'
  | 'timeout'
  | 'aborted'
  | 'identity-refused'
  | 'unknown-peer'
  | 'unsupported'
  | 'pairing-refused'
  | 'busy'
  | 'protocol';

export interface ChannelOpenDetail {
  /** `unsupported` only: what the responder speaks. */
  linkProtocol?: number;
  serverVersion?: string;
  cause?: string;
}

export class ChannelOpenError extends Error {
  constructor(
    readonly code: ChannelOpenErrorCode,
    message: string,
    readonly detail: ChannelOpenDetail = {},
  ) {
    super(message);
    this.name = 'ChannelOpenError';
  }
}

export interface ChannelMarker {
  mode: ChannelMode;
  /** Peer static key, 64 lowercase hex characters. */
  remoteKeyHex: string;
  /** Pairing mode only. */
  pairingId: string | null;
  /** Approval mode only (PAN-2356): the approval request id, 32 hex. */
  requestId?: string;
  /** Approval mode only: the six-digit SAS both operators compare, as `123 456`. */
  approvalSas?: string;
}

interface CommonInitiatorOptions {
  localKey: StaticKeyPair;
  signal?: AbortSignal;
  /** Whole open (connect + handshake) must finish within this; default 10 s. */
  timeoutMs?: number;
}

export type InitiatorOptions =
  | (CommonInitiatorOptions & { mode: 'link'; remoteKeyHex: string })
  | (CommonInitiatorOptions & { mode: 'pairing'; pairingCode: string })
  /** PAN-2356 D-2356-9: Noise XX for one approval request (32 hex); authenticated only by the SAS. */
  | (CommonInitiatorOptions & { mode: 'approval'; requestId: string });

export interface InitiatorDone<R extends RawDuplex = RawDuplex> {
  raw: R;
  handshake: HandshakeResult;
  /** Bytes that arrived behind the last handshake frame. */
  leftover: Uint8Array;
  channel: ChannelMarker;
}

/** Called in the same tick as the last handshake frame; must build the secure stream synchronously. */
export type InitiatorFinish<T, R extends RawDuplex = RawDuplex> = (done: InitiatorDone<R>) => T;

interface Tracked<R extends RawDuplex> {
  raw: R | null;
  reader: FrameReader | null;
}

/**
 * Deadline + abort plumbing shared by every entry point: a timer and the
 * caller's signal both abort an internal controller; aborting fails the
 * pending frame read and destroys the transport.
 */
export async function withDeadline<T, R extends RawDuplex>(
  label: string,
  opts: { signal?: AbortSignal; timeoutMs?: number },
  run: (signal: AbortSignal, track: (raw: R, reader?: FrameReader) => void) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const tracked: Tracked<R> = { raw: null, reader: null };
  let reason: ChannelOpenError | null = null;
  const abortWith = (error: ChannelOpenError): void => {
    if (reason) return;
    reason = error;
    controller.abort(error);
  };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  const timer = setTimeout(
    () => abortWith(new ChannelOpenError('timeout', `Secure channel to ${label} did not open within ${timeoutMs} ms`)),
    timeoutMs,
  );
  const onExternalAbort = (): void => abortWith(new ChannelOpenError('aborted', `Secure channel open to ${label} was aborted`));
  if (opts.signal?.aborted) onExternalAbort();
  else opts.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const onAbort = (): void => {
    if (reason) tracked.reader?.fail(reason);
    tracked.raw?.destroy();
  };
  controller.signal.addEventListener('abort', onAbort, { once: true });

  try {
    if (reason) throw reason;
    return await run(controller.signal, (raw, reader) => {
      tracked.raw = raw;
      if (reader) tracked.reader = reader;
    });
  } catch (error) {
    tracked.reader?.detach();
    if (tracked.raw && !tracked.raw.destroyed) tracked.raw.destroy();
    throw reason ?? toOpenError(error, label);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Run the initiator handshake over a connected raw duplex. `finish` runs after
 * `reader.detach()` and after the final handshake message is written, in the
 * same tick, so bytes behind the last handshake frame reach the secure stream.
 */
export async function runInitiatorHandshake<T, R extends RawDuplex>(
  raw: R,
  label: string,
  opts: InitiatorOptions,
  crypto: CryptoPort,
  track: (raw: R, reader?: FrameReader) => void,
  finish: InitiatorFinish<T, R>,
): Promise<T> {
  const reader = new FrameReader(raw);
  // Register the reader with the deadline so an abort fails the pending read.
  track(raw, reader);
  const complete = (handshake: { result(): HandshakeResult }, finalMessage: Uint8Array | null, channel: ChannelMarker): T => {
    const leftover = reader.detach();
    if (finalMessage) raw.write(encodeFrame(finalMessage));
    return finish({ raw, handshake: handshake.result(), leftover, channel });
  };

  if (opts.mode === 'link') {
    raw.write(encodePreamble({ linkProtocol: NOISE_LINK_PROTOCOL, mode: 'link', pairingId: null }));
    const handshake = ikInitiator(opts.localKey, b4a.from(opts.remoteKeyHex, 'hex'), prologueFor('link', null));
    raw.write(encodeFrame(handshake.send()));
    const message2 = await readMessage(reader, 'link');
    try {
      handshake.recv(message2);
    } catch {
      throw new ChannelOpenError('identity-refused', `${label} did not prove the pinned machine key`);
    }
    return complete(handshake, null, { mode: 'link', remoteKeyHex: opts.remoteKeyHex, pairingId: null });
  }

  if (opts.mode === 'approval') {
    raw.write(encodePreamble({ linkProtocol: NOISE_LINK_PROTOCOL, mode: 'approval', pairingId: opts.requestId }));
    const handshake = xxInitiator(opts.localKey, prologueFor('approval', opts.requestId));
    raw.write(encodeFrame(handshake.send()));
    const message2 = await readMessage(reader, 'approval');
    try {
      handshake.recv(message2);
    } catch {
      throw new ChannelOpenError('protocol', `${label} sent an approval handshake message that did not verify`);
    }
    raw.write(encodeFrame(handshake.send()));
    const remoteKeyHex = b4a.toString(handshake.remoteKey(), 'hex');
    // Commit-then-reveal (D-2356-10 amended): commit to our nonce, take the responder's, reveal ours.
    const hash = handshake.result().hash;
    const nonce = approvalNonce(crypto);
    raw.write(encodeFrame(approvalCommitment(crypto, hash, nonce)));
    const responderNonce = await readMessage(reader, 'approval');
    if (responderNonce.length !== APPROVAL_NONCE_BYTES) {
      throw new ChannelOpenError('protocol', `${label} sent an approval nonce of ${responderNonce.length} bytes`);
    }
    const sas = approvalSas(crypto, hash, nonce, responderNonce);
    return complete(handshake, nonce, { mode: 'approval', remoteKeyHex, pairingId: null, requestId: opts.requestId, approvalSas: sas });
  }

  const { psk, pairingId } = pairingSecrets(crypto, opts.pairingCode);
  raw.write(encodePreamble({ linkProtocol: NOISE_LINK_PROTOCOL, mode: 'pairing', pairingId }));
  const handshake = xxPskInitiator(opts.localKey, psk, prologueFor('pairing', pairingId));
  raw.write(encodeFrame(handshake.send()));
  const message2 = await readMessage(reader, 'pairing');
  try {
    handshake.recv(message2);
  } catch {
    throw new ChannelOpenError('pairing-refused', `${label} did not accept the pairing code`);
  }
  const message3 = handshake.send();
  const remoteKeyHex = b4a.toString(handshake.remoteKey(), 'hex');
  return complete(handshake, message3, { mode: 'pairing', remoteKeyHex, pairingId });
}

async function readMessage(reader: FrameReader, mode: ChannelMode): Promise<Uint8Array> {
  let frame;
  try {
    frame = await reader.readFrame();
  } catch (error) {
    if (error instanceof WireError && error.code === 'closed') {
      // The responder dropped us without a refusal: in link mode it could not
      // decrypt message 1 (it does not hold the key we pinned).
      if (mode === 'link') {
        throw new ChannelOpenError('identity-refused', 'Responder closed the connection before proving the pinned machine key');
      }
      throw new ChannelOpenError('pairing-refused', `Responder closed the connection during ${mode === 'approval' ? 'approval' : 'pairing'}`);
    }
    throw error;
  }
  if (frame.kind === 'refusal') {
    if (mode === 'approval' && frame.refusal.code === REFUSAL_CODES.pairingRefused) {
      throw new ChannelOpenError('pairing-refused', 'Responder has no live approval request with this id');
    }
    throw refusalToError(frame.refusal);
  }
  return frame.payload;
}

function refusalToError(refusal: Refusal): ChannelOpenError {
  switch (refusal.code) {
    case REFUSAL_CODES.unknownPeer:
      return new ChannelOpenError('unknown-peer', 'Responder does not hold a machine token for this machine key');
    case REFUSAL_CODES.unsupported:
      return new ChannelOpenError(
        'unsupported',
        `Responder speaks link protocol ${refusal.linkProtocol} (Overdeck ${refusal.serverVersion || 'unknown version'})`,
        { linkProtocol: refusal.linkProtocol, serverVersion: refusal.serverVersion },
      );
    case REFUSAL_CODES.pairingRefused:
      return new ChannelOpenError('pairing-refused', 'Responder refused the pairing id or code');
    case REFUSAL_CODES.busy:
      return new ChannelOpenError('busy', 'Responder has too many handshakes pending');
  }
}

/** Map any failure while opening a channel to a {@link ChannelOpenError}. */
export function toOpenError(error: unknown, url: string): ChannelOpenError {
  if (error instanceof ChannelOpenError) return error;
  if (error instanceof WireError) {
    return new ChannelOpenError('protocol', `${url}: ${error.message}`, { cause: error.code });
  }
  return new ChannelOpenError('unreachable', `${url}: ${(error as Error)?.message ?? String(error)}`);
}
