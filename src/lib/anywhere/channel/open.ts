/**
 * Initiator side of a secure channel (PAN-4645 WI-2, D-4645-5).
 *
 * `openChannel` connects a transport (`tcp://host:port` raw TCP to the
 * dashboard port, or `wss://host[:port]/ws/link` inside HTTPS), writes the
 * preamble, runs Noise IK (link: proves the pinned machine key before any
 * application byte) or XXpsk0 (pairing: keyed by the pairing code) and
 * resolves with a {@link ChannelSocket}.
 *
 * Timeouts use `AbortController` + `setTimeout`, never `AbortSignal.timeout`
 * (it ignores fake timers under happy-dom).
 */
import { connect as netConnect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { createWebSocketStream, WebSocket as WsClient } from 'ws';

import type { MachineKeyPair } from '../machine-key.js';
import { type ChannelMarker, type ChannelSocket, createChannelSocket } from './channel-socket.js';
import { APPROVAL_NONCE_BYTES, approvalCommitment, approvalNonce, approvalSas, type Handshake, ikInitiator, NOISE_LINK_PROTOCOL, pairingSecrets, prologueFor, xxInitiator, xxPskInitiator } from './noise.js';
import { type ChannelMode, encodeFrame, encodePreamble, FrameReader, type Refusal, REFUSAL_CODES, WireError } from './wire.js';

export const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

/** wss route query parameter naming one Fly machine; sent as `fly-force-instance-id` (PAN-4652 D-3). */
export const FLY_INSTANCE_PARAM = 'fly-instance';

export type TransportUrl = `tcp://${string}` | `wss://${string}` | `rtc://${string}` | `rtc+turn://${string}`;

/** Opens a WebRTC data channel to `rtc://<id>` or `rtc+turn://<id>` (PAN-2356 WI-11). */
export type RtcDialer = (url: `rtc://${string}` | `rtc+turn://${string}`, signal: AbortSignal) => Promise<Duplex>;

let rtcDialer: RtcDialer | null = null;

/** The dashboard registers the directory's WebRTC dialer here; null when signed out. */
export function setRtcDialer(dialer: RtcDialer | null): void {
  rtcDialer = dialer;
}

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

interface CommonOpenOptions {
  localKey: MachineKeyPair;
  signal?: AbortSignal;
  /** Whole open (connect + handshake) must finish within this; default 10 s. */
  timeoutMs?: number;
}

export type OpenChannelOptions =
  | (CommonOpenOptions & { mode: 'link'; remoteKeyHex: string })
  | (CommonOpenOptions & { mode: 'pairing'; pairingCode: string })
  /** PAN-2356 D-2356-9: Noise XX for one approval request (32 hex); authenticated only by the SAS. */
  | (CommonOpenOptions & { mode: 'approval'; requestId: string });

export async function openChannel(url: TransportUrl, opts: OpenChannelOptions): Promise<ChannelSocket> {
  return withDeadline(url, opts, async (signal, track) => {
    const raw = await connectTransport(url, signal);
    track(raw);
    return handshakeAsInitiator(raw, url, opts, track);
  });
}

/**
 * Run the initiator handshake over a transport that is already connected
 * (for example a `/ws/link` WebSocket stream the caller opened itself).
 * The same timeout and abort rules as {@link openChannel} apply.
 */
export async function openChannelOverTransport(raw: Duplex, opts: OpenChannelOptions, label = 'transport'): Promise<ChannelSocket> {
  return withDeadline(label, opts, async (_signal, track) => {
    track(raw);
    return handshakeAsInitiator(raw, label, opts, track);
  });
}

interface Tracked {
  raw: Duplex | null;
  reader: FrameReader | null;
}

/**
 * Deadline + abort plumbing shared by both entry points: a timer and the
 * caller's signal both abort an internal controller; aborting fails the
 * pending frame read and destroys the transport.
 */
async function withDeadline(
  label: string,
  opts: OpenChannelOptions,
  run: (signal: AbortSignal, track: (raw: Duplex, reader?: FrameReader) => void) => Promise<ChannelSocket>,
): Promise<ChannelSocket> {
  const controller = new AbortController();
  const tracked: Tracked = { raw: null, reader: null };
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

async function handshakeAsInitiator(
  raw: Duplex,
  label: string,
  opts: OpenChannelOptions,
  track: (raw: Duplex, reader?: FrameReader) => void,
): Promise<ChannelSocket> {
  const reader = new FrameReader(raw);
  // Register the reader with the deadline so an abort fails the pending read.
  track(raw, reader);

  if (opts.mode === 'link') {
    raw.write(encodePreamble({ linkProtocol: NOISE_LINK_PROTOCOL, mode: 'link', pairingId: null }));
    const handshake = ikInitiator(opts.localKey, Buffer.from(opts.remoteKeyHex, 'hex'), prologueFor('link', null));
    raw.write(encodeFrame(handshake.send()));
    const message2 = await readMessage(reader, 'link');
    try {
      handshake.recv(message2);
    } catch {
      throw new ChannelOpenError('identity-refused', `${label} did not prove the pinned machine key`);
    }
    return finish(raw, reader, handshake, null, { mode: 'link', remoteKeyHex: opts.remoteKeyHex, pairingId: null });
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
    const remoteKeyHex = handshake.remoteKey().toString('hex');
    // Commit-then-reveal (D-2356-10 amended): commit to our nonce, take the responder's, reveal ours.
    const hash = handshake.result().hash;
    const nonce = approvalNonce();
    raw.write(encodeFrame(approvalCommitment(hash, nonce)));
    const responderNonce = await readMessage(reader, 'approval');
    if (responderNonce.length !== APPROVAL_NONCE_BYTES) {
      throw new ChannelOpenError('protocol', `${label} sent an approval nonce of ${responderNonce.length} bytes`);
    }
    const sas = approvalSas(hash, nonce, responderNonce);
    return finish(raw, reader, handshake, nonce, { mode: 'approval', remoteKeyHex, pairingId: null, requestId: opts.requestId, approvalSas: sas });
  }

  const { psk, pairingId } = pairingSecrets(opts.pairingCode);
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
  const remoteKeyHex = handshake.remoteKey().toString('hex');
  return finish(raw, reader, handshake, message3, { mode: 'pairing', remoteKeyHex, pairingId });
}

function finish(
  raw: Duplex,
  reader: FrameReader,
  handshake: Handshake,
  finalMessage: Buffer | null,
  channel: ChannelMarker,
): ChannelSocket {
  const leftover = reader.detach();
  if (finalMessage) raw.write(encodeFrame(finalMessage));
  return createChannelSocket({ raw, initiator: true, handshake: handshake.result(), channel, leftover });
}

async function readMessage(reader: FrameReader, mode: ChannelMode): Promise<Buffer> {
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

function toOpenError(error: unknown, url: string): ChannelOpenError {
  if (error instanceof ChannelOpenError) return error;
  if (error instanceof WireError) {
    return new ChannelOpenError('protocol', `${url}: ${error.message}`, { cause: error.code });
  }
  return new ChannelOpenError('unreachable', `${url}: ${(error as Error)?.message ?? String(error)}`);
}

type TransportTarget =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'wss'; url: string; headers?: Record<string, string> };

function parseTransportUrl(url: TransportUrl): TransportTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ChannelOpenError('protocol', `Not a transport URL: ${url}`);
  }
  if (parsed.protocol === 'tcp:') {
    const port = Number(parsed.port);
    if (!parsed.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new ChannelOpenError('protocol', `tcp:// transport needs host and port: ${url}`);
    }
    return { kind: 'tcp', host: parsed.hostname.replace(/^\[|\]$/g, ''), port };
  }
  if (parsed.protocol === 'wss:') {
    // Many Fly machines share `<app>.fly.dev`; the Fly proxy pins one by this header.
    const instance = parsed.searchParams.get(FLY_INSTANCE_PARAM);
    if (!instance) return { kind: 'wss', url };
    parsed.searchParams.delete(FLY_INSTANCE_PARAM);
    return { kind: 'wss', url: parsed.toString(), headers: { 'fly-force-instance-id': instance } };
  }
  throw new ChannelOpenError('protocol', `Unsupported transport scheme in ${url}`);
}

function connectTransport(url: TransportUrl, signal: AbortSignal): Promise<Duplex> {
  if (url.startsWith('rtc://') || url.startsWith('rtc+turn://')) {
    const rtcUrl = url as `rtc://${string}` | `rtc+turn://${string}`;
    if (!rtcDialer) {
      return Promise.reject(new ChannelOpenError('unreachable', 'Direct connections need an overdeck.ai sign-in'));
    }
    if (signal.aborted) return Promise.reject(toOpenError(signal.reason, url));
    return rtcDialer(rtcUrl, signal).catch((error: unknown) => {
      throw toOpenError(signal.aborted ? signal.reason : error, url);
    });
  }
  const target = parseTransportUrl(url);
  return new Promise<Duplex>((resolve, reject) => {
    const fail = (error: unknown): void => reject(toOpenError(error, url));
    if (signal.aborted) {
      fail(signal.reason);
      return;
    }
    if (target.kind === 'tcp') {
      const socket: Socket = netConnect({ host: target.host, port: target.port });
      const onAbort = (): void => {
        socket.destroy();
        fail(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.once('error', (error) => {
        signal.removeEventListener('abort', onAbort);
        fail(error);
      });
      socket.once('connect', () => {
        signal.removeEventListener('abort', onAbort);
        socket.setNoDelay(true);
        resolve(socket);
      });
      return;
    }
    const ws = new WsClient(target.url, target.headers ? { headers: target.headers } : undefined);
    const onAbort = (): void => {
      ws.terminate();
      fail(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    ws.once('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      fail(error);
    });
    ws.once('open', () => {
      signal.removeEventListener('abort', onAbort);
      resolve(createWebSocketStream(ws));
    });
  });
}
