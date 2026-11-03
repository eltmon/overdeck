/**
 * RFC 6455 WebSocket framing for the phone's channel WebSocket (PAN-4834 WI-3).
 *
 * Pure byte-level helpers: the opening-handshake key and accept value, masked
 * client frames, close payloads, and an incremental decoder for server frames.
 * The client never offers an extension, so every RSV bit must be zero.
 *
 * SHA-1 comes from `@noble/hashes/legacy.js` directly; the `CryptoPort` keeps
 * the three primitives PAN-4833 golden-vectored (PAN-4834 D-7).
 */
import { sha1 } from '@noble/hashes/legacy.js';
import b4a from 'b4a';

import type { CryptoPort } from './crypto-port.js';

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OPCODES = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;
export type Opcode = (typeof OPCODES)[keyof typeof OPCODES];
export const MAX_WS_MESSAGE_BYTES = 32 * 1024 * 1024;

const MAX_CONTROL_PAYLOAD = 125;
const KNOWN_OPCODES = new Set<number>(Object.values(OPCODES));

export class WsProtocolError extends Error {
  constructor(
    /** The close code to send: 1002 protocol error, 1007 invalid data, 1009 message too big. */
    readonly closeCode: 1002 | 1007 | 1009,
    message: string,
  ) {
    super(message);
    this.name = 'WsProtocolError';
  }
}

export type WsEvent =
  | { type: 'text'; data: string }
  | { type: 'binary'; data: Uint8Array }
  | { type: 'ping' | 'pong'; data: Uint8Array }
  | { type: 'close'; code: number; reason: string };

const encoder = new TextEncoder();

/** The `Sec-WebSocket-Key` value: base64 of 16 random bytes. */
export function websocketKey(crypto: CryptoPort): string {
  return b4a.toString(crypto.randomBytes(16), 'base64');
}

/** The `Sec-WebSocket-Accept` value the server must return for `key` (RFC 6455 §4.2.2). */
export function acceptFor(key: string): string {
  return b4a.toString(sha1(encoder.encode(key + WS_GUID)), 'base64');
}

/** One masked client frame. `mask` is the 4-byte masking key. */
export function encodeClientFrame(opcode: Opcode, payload: Uint8Array, mask: Uint8Array, fin = true): Uint8Array {
  if (mask.length !== 4) throw new TypeError('A WebSocket masking key is 4 bytes');
  const length = payload.length;
  const lengthBytes = length < 126 ? 0 : length < 0x10000 ? 2 : 8;
  const headerLength = 2 + lengthBytes + 4;
  const frame = new Uint8Array(headerLength + length);
  const view = new DataView(frame.buffer);
  frame[0] = (fin ? 0x80 : 0) | opcode;
  if (lengthBytes === 0) {
    frame[1] = 0x80 | length;
  } else if (lengthBytes === 2) {
    frame[1] = 0x80 | 126;
    view.setUint16(2, length);
  } else {
    frame[1] = 0x80 | 127;
    view.setUint32(2, Math.floor(length / 0x1_0000_0000));
    view.setUint32(6, length >>> 0);
  }
  frame.set(mask, 2 + lengthBytes);
  for (let i = 0; i < length; i++) frame[headerLength + i] = payload[i] ^ mask[i & 3];
  return frame;
}

/** A close frame payload: empty without a code, else the 2-byte code and the UTF-8 reason. */
export function encodeClosePayload(code?: number, reason = ''): Uint8Array {
  if (code === undefined) return new Uint8Array(0);
  const reasonBytes = encoder.encode(reason);
  const payload = new Uint8Array(2 + reasonBytes.length);
  new DataView(payload.buffer).setUint16(0, code);
  payload.set(reasonBytes, 2);
  return payload;
}

/** Close codes a peer may put on the wire (RFC 6455 §7.4, IANA registry). */
function isValidCloseCode(code: number): boolean {
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999);
}

export function decodeClosePayload(payload: Uint8Array): { code: number; reason: string } {
  if (payload.length === 0) return { code: 1005, reason: '' };
  if (payload.length === 1) throw new WsProtocolError(1002, 'A close payload of one byte is invalid');
  const code = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(0);
  if (!isValidCloseCode(code)) throw new WsProtocolError(1002, `Invalid close code ${code}`);
  return { code, reason: decodeUtf8(payload.subarray(2)) };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WsProtocolError(1007, 'Text is not valid UTF-8');
  }
}

export interface FrameDecoderOptions {
  maxMessageBytes?: number;
}

/** Decodes server frames from bytes pushed in any slicing; reassembles fragmented messages. */
export class FrameDecoder {
  private readonly maxMessageBytes: number;
  /** Bytes not yet parsed, kept as chunks until {@link need} of them are present. */
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  /** Bytes the next parse step needs: a frame header, or the whole current frame. */
  private need = 2;
  /** The data message being reassembled: its opcode and fragments so far. */
  private message: { opcode: typeof OPCODES.text | typeof OPCODES.binary; parts: Uint8Array[]; bytes: number } | null =
    null;
  private closed = false;

  constructor(options: FrameDecoderOptions = {}) {
    this.maxMessageBytes = options.maxMessageBytes ?? MAX_WS_MESSAGE_BYTES;
  }

  /** Returns every event completed by `chunk`, in wire order. Bytes after a close frame are ignored. */
  push(chunk: Uint8Array): WsEvent[] {
    if (this.closed || chunk.length === 0) return [];
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (this.pendingBytes < this.need) return [];
    const buf = this.pending.length === 1 ? this.pending[0] : b4a.concat(this.pending, this.pendingBytes);
    const events: WsEvent[] = [];
    let offset = 0;
    for (;;) {
      const frame = this.readFrame(buf, offset);
      if ('need' in frame) {
        this.need = frame.need;
        break;
      }
      offset = frame.end;
      const event = this.onFrame(frame.fin, frame.opcode, frame.payload);
      if (event) events.push(event);
      if (this.closed) break;
    }
    const rest = this.closed ? new Uint8Array(0) : buf.subarray(offset);
    this.pending = rest.length > 0 ? [rest] : [];
    this.pendingBytes = rest.length;
    return events;
  }

  /** Parses the frame starting at `offset`, or says how many bytes from `offset` it needs. */
  private readFrame(
    buf: Uint8Array,
    offset: number,
  ): { fin: boolean; opcode: number; payload: Uint8Array; end: number } | { need: number } {
    const available = buf.length - offset;
    if (available < 2) return { need: 2 };
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    if ((b0 & 0x70) !== 0) throw new WsProtocolError(1002, 'Reserved bits are set but no extension was negotiated');
    if (!KNOWN_OPCODES.has(opcode)) throw new WsProtocolError(1002, `Unknown opcode ${opcode}`);
    if ((b1 & 0x80) !== 0) throw new WsProtocolError(1002, 'A server frame must not be masked');
    const isControl = opcode >= 0x8;
    let length = b1 & 0x7f;
    let headerLength = 2;
    if (isControl && (!fin || length > MAX_CONTROL_PAYLOAD)) {
      throw new WsProtocolError(1002, 'A control frame must be final and at most 125 bytes');
    }
    if (opcode === OPCODES.continuation && !this.message) {
      throw new WsProtocolError(1002, 'A continuation frame arrived with no message in progress');
    }
    if ((opcode === OPCODES.text || opcode === OPCODES.binary) && this.message) {
      throw new WsProtocolError(1002, 'A new data frame arrived inside a fragmented message');
    }
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (length === 126) {
      if (available < 4) return { need: 4 };
      length = view.getUint16(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (available < 10) return { need: 10 };
      const high = view.getUint32(offset + 2);
      if ((high & 0x8000_0000) !== 0) throw new WsProtocolError(1002, 'A 64-bit frame length has its top bit set');
      length = high * 0x1_0000_0000 + view.getUint32(offset + 6);
      headerLength = 10;
    }
    if (!isControl && (this.message?.bytes ?? 0) + length > this.maxMessageBytes) {
      throw new WsProtocolError(1009, `A message exceeds ${this.maxMessageBytes} bytes`);
    }
    const end = offset + headerLength + length;
    if (buf.length < end) return { need: headerLength + length };
    return { fin, opcode, payload: new Uint8Array(buf.subarray(offset + headerLength, end)), end };
  }

  private onFrame(fin: boolean, opcode: number, payload: Uint8Array): WsEvent | null {
    switch (opcode) {
      case OPCODES.ping:
        return { type: 'ping', data: payload };
      case OPCODES.pong:
        return { type: 'pong', data: payload };
      case OPCODES.close: {
        this.closed = true;
        return { type: 'close', ...decodeClosePayload(payload) };
      }
      case OPCODES.text:
      case OPCODES.binary:
        this.message = { opcode, parts: [], bytes: 0 };
        break;
    }
    const message = this.message!;
    message.parts.push(payload);
    message.bytes += payload.length;
    if (!fin) return null;
    this.message = null;
    const data = message.parts.length === 1 ? message.parts[0] : new Uint8Array(message.bytes);
    if (message.parts.length > 1) {
      let at = 0;
      for (const part of message.parts) {
        data.set(part, at);
        at += part.length;
      }
    }
    return message.opcode === OPCODES.text ? { type: 'text', data: decodeUtf8(data) } : { type: 'binary', data };
  }
}
