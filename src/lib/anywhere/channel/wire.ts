/**
 * Secure-channel wire format (PAN-4645 D-4645-5).
 *
 * Everything on the wire before the Noise handshake completes:
 *
 *  1. Preamble, sent by the initiator: `00 4F 56 44 4C <linkProtocol> <mode>`
 *     (`\0OVDL`), mode `01` = link (Noise IK), `02` = pairing (Noise XXpsk0).
 *     Pairing mode appends the 16-byte pairing id.
 *  2. Handshake messages, each `uint24le length` + message, at most
 *     {@link MAX_HANDSHAKE_FRAME} bytes.
 *  3. A frame whose length is `0` followed by one code byte is a refusal
 *     ({@link REFUSAL_CODES}). Code `02` is followed by the responder's link
 *     protocol (`uint8`) and a `uint8`-length-prefixed UTF-8 server version.
 *
 * After the handshake, bytes belong to `@hyperswarm/secret-stream`. Nothing
 * here carries application data.
 */
import type { Duplex } from 'node:stream';

export type ChannelMode = 'link' | 'pairing';

export const PREAMBLE_MAGIC = Buffer.from([0x00, 0x4f, 0x56, 0x44, 0x4c]);
/** Magic (5) + link protocol (1) + mode (1). */
export const PREAMBLE_LENGTH = 7;
export const PAIRING_ID_LENGTH = 16;
export const FRAME_HEADER_LENGTH = 3;
export const MAX_HANDSHAKE_FRAME = 1024;
/** Hard cap on bytes buffered while waiting for one handshake frame. */
const MAX_BUFFERED = 4096;

export const MODE_BYTES: Record<ChannelMode, number> = { link: 0x01, pairing: 0x02 };

export const REFUSAL_CODES = {
  /** IK initiator's static key is not pinned here. */
  unknownPeer: 0x01,
  /** Preamble link protocol differs from ours. */
  unsupported: 0x02,
  /** Pairing id unknown, expired, or the pairing code did not match. */
  pairingRefused: 0x03,
  /** Too many handshakes pending. */
  busy: 0x04,
} as const;
export type RefusalCode = (typeof REFUSAL_CODES)[keyof typeof REFUSAL_CODES];

export interface Refusal {
  code: RefusalCode;
  /** Code `02` only: the responder's link protocol. */
  linkProtocol?: number;
  /** Code `02` only: the responder's Overdeck version. */
  serverVersion?: string;
}

export interface Preamble {
  linkProtocol: number;
  mode: ChannelMode;
  /** 32 lowercase hex characters; pairing mode only. */
  pairingId: string | null;
}

export type Frame = { kind: 'message'; payload: Buffer } | { kind: 'refusal'; refusal: Refusal };

export type WireErrorCode = 'bad-preamble' | 'bad-frame' | 'frame-too-large' | 'closed';

export class WireError extends Error {
  constructor(
    readonly code: WireErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WireError';
  }
}

export function encodePreamble(preamble: Preamble): Buffer {
  const head = Buffer.alloc(PREAMBLE_LENGTH);
  PREAMBLE_MAGIC.copy(head, 0);
  head[5] = preamble.linkProtocol & 0xff;
  head[6] = MODE_BYTES[preamble.mode];
  if (preamble.mode !== 'pairing') return head;
  if (preamble.pairingId === null || !/^[0-9a-f]{32}$/.test(preamble.pairingId)) {
    throw new WireError('bad-preamble', 'Pairing preamble needs a 16-byte pairing id');
  }
  return Buffer.concat([head, Buffer.from(preamble.pairingId, 'hex')]);
}

/**
 * Parse the fixed 7-byte head of a preamble. The caller reads the 16-byte
 * pairing id afterwards when `mode === 'pairing'`.
 */
export function parsePreambleHead(head: Buffer): Omit<Preamble, 'pairingId'> {
  if (head.length !== PREAMBLE_LENGTH || !head.subarray(0, 5).equals(PREAMBLE_MAGIC)) {
    throw new WireError('bad-preamble', 'Not an Overdeck secure-channel preamble');
  }
  const linkProtocol = head[5]!;
  const modeByte = head[6]!;
  const mode = modeByte === MODE_BYTES.link ? 'link' : modeByte === MODE_BYTES.pairing ? 'pairing' : null;
  if (mode === null) throw new WireError('bad-preamble', `Unknown channel mode byte ${modeByte}`);
  return { linkProtocol, mode };
}

function writeUint24le(value: number, into: Buffer): void {
  into[0] = value & 0xff;
  into[1] = (value >>> 8) & 0xff;
  into[2] = (value >>> 16) & 0xff;
}

function readUint24le(from: Buffer): number {
  return from[0]! | (from[1]! << 8) | (from[2]! << 16);
}

/** `uint24le length` + handshake message. */
export function encodeFrame(message: Uint8Array): Buffer {
  if (message.byteLength === 0 || message.byteLength > MAX_HANDSHAKE_FRAME) {
    throw new WireError('frame-too-large', `Handshake frame of ${message.byteLength} bytes is out of range`);
  }
  const frame = Buffer.alloc(FRAME_HEADER_LENGTH + message.byteLength);
  writeUint24le(message.byteLength, frame);
  frame.set(message, FRAME_HEADER_LENGTH);
  return frame;
}

export function encodeRefusal(refusal: Refusal): Buffer {
  const head = Buffer.from([0, 0, 0, refusal.code]);
  if (refusal.code !== REFUSAL_CODES.unsupported) return head;
  const version = Buffer.from(refusal.serverVersion ?? '', 'utf8').subarray(0, 255);
  return Buffer.concat([head, Buffer.from([(refusal.linkProtocol ?? 0) & 0xff, version.length]), version]);
}

interface Pending<T> {
  /** Returns the parsed value and the bytes consumed, or `null` when more bytes are needed. */
  parse: (buffered: Buffer) => { value: T; consumed: number } | null;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Reads preamble bytes and handshake frames from a raw duplex during the
 * handshake. `detach()` removes every listener and returns the bytes that
 * arrived after the last consumed frame, so they can be handed to the secure
 * stream in the same tick (the peer's first secret-stream header may share a
 * TCP segment with its last handshake message).
 */
export class FrameReader {
  private buffered: Buffer = Buffer.alloc(0);
  private pending: Pending<unknown> | null = null;
  private failure: Error | null = null;
  private detached = false;

  private readonly onData = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    this.buffered = this.buffered.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.buffered, bytes]);
    if (this.buffered.length > MAX_BUFFERED) {
      this.fail(new WireError('frame-too-large', 'Peer sent too many bytes during the handshake'));
      return;
    }
    this.pump();
  };

  private readonly onClose = (): void => {
    this.fail(new WireError('closed', 'Peer closed the connection during the handshake'));
  };

  private readonly onError = (error: Error): void => {
    this.fail(error);
  };

  constructor(private readonly raw: Duplex) {
    raw.on('data', this.onData);
    raw.on('end', this.onClose);
    raw.on('close', this.onClose);
    raw.on('error', this.onError);
  }

  /** Reject the pending read (and every later one) with `error`. */
  fail(error: Error): void {
    if (this.failure === null) this.failure = error;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(this.failure);
  }

  readBytes(count: number): Promise<Buffer> {
    return this.read((buffered) =>
      buffered.length >= count ? { value: Buffer.from(buffered.subarray(0, count)), consumed: count } : null,
    );
  }

  readFrame(): Promise<Frame> {
    return this.read(parseFrame);
  }

  /** Stop reading. Returns the unconsumed bytes; the raw stream keeps flowing. */
  detach(): Buffer {
    if (this.detached) return Buffer.alloc(0);
    this.detached = true;
    this.raw.off('data', this.onData);
    this.raw.off('end', this.onClose);
    this.raw.off('close', this.onClose);
    this.raw.off('error', this.onError);
    if (this.pending) this.fail(new WireError('closed', 'Frame reader detached'));
    const leftover = this.buffered;
    this.buffered = Buffer.alloc(0);
    return leftover;
  }

  private read<T>(parse: Pending<T>['parse']): Promise<T> {
    if (this.pending) return Promise.reject(new Error('FrameReader: one read at a time'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.detached) return Promise.reject(new WireError('closed', 'Frame reader detached'));
    return new Promise<T>((resolve, reject) => {
      this.pending = { parse, resolve, reject } as Pending<unknown>;
      this.pump();
    });
  }

  private pump(): void {
    const pending = this.pending;
    if (!pending) return;
    let result: { value: unknown; consumed: number } | null;
    try {
      result = pending.parse(this.buffered);
    } catch (error) {
      this.fail(error as Error);
      return;
    }
    if (result === null) return;
    this.buffered = this.buffered.subarray(result.consumed);
    this.pending = null;
    pending.resolve(result.value);
  }
}

function parseFrame(buffered: Buffer): { value: Frame; consumed: number } | null {
  if (buffered.length < FRAME_HEADER_LENGTH) return null;
  const length = readUint24le(buffered);
  if (length > MAX_HANDSHAKE_FRAME) {
    throw new WireError('frame-too-large', `Peer announced a ${length}-byte handshake frame`);
  }
  if (length > 0) {
    const end = FRAME_HEADER_LENGTH + length;
    if (buffered.length < end) return null;
    return { value: { kind: 'message', payload: Buffer.from(buffered.subarray(FRAME_HEADER_LENGTH, end)) }, consumed: end };
  }
  if (buffered.length < 4) return null;
  const code = buffered[3]!;
  if (code !== REFUSAL_CODES.unknownPeer && code !== REFUSAL_CODES.unsupported
    && code !== REFUSAL_CODES.pairingRefused && code !== REFUSAL_CODES.busy) {
    throw new WireError('bad-frame', `Unknown refusal code ${code}`);
  }
  if (code !== REFUSAL_CODES.unsupported) {
    return { value: { kind: 'refusal', refusal: { code } }, consumed: 4 };
  }
  if (buffered.length < 6) return null;
  const versionLength = buffered[5]!;
  const end = 6 + versionLength;
  if (buffered.length < end) return null;
  return {
    value: {
      kind: 'refusal',
      refusal: { code, linkProtocol: buffered[4]!, serverVersion: buffered.subarray(6, end).toString('utf8') },
    },
    consumed: end,
  };
}
