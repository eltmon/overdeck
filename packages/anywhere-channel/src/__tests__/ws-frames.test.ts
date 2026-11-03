/** PAN-4834 WI-3: RFC 6455 framing, close payloads and the accept key. */
import { describe, expect, it } from 'vitest';

import { webCrypto } from '../crypto-web.js';
import {
  acceptFor,
  decodeClosePayload,
  encodeClientFrame,
  encodeClosePayload,
  FrameDecoder,
  OPCODES,
  websocketKey,
  WsProtocolError,
} from '../ws-frames.js';

const encoder = new TextEncoder();
const bytes = (value: string): Uint8Array => encoder.encode(value);

/** An unmasked server frame, the way a server writes it. */
function serverFrame(opcode: number, payload: Uint8Array, options: { fin?: boolean; rsv?: number; masked?: boolean } = {}): Uint8Array {
  const { fin = true, rsv = 0, masked = false } = options;
  const length = payload.length;
  const extended = length < 126 ? 0 : length < 0x10000 ? 2 : 8;
  const maskBytes = masked ? 4 : 0;
  const frame = new Uint8Array(2 + extended + maskBytes + length);
  const view = new DataView(frame.buffer);
  frame[0] = (fin ? 0x80 : 0) | (rsv << 4) | opcode;
  const lengthField = extended === 0 ? length : extended === 2 ? 126 : 127;
  frame[1] = (masked ? 0x80 : 0) | lengthField;
  if (extended === 2) view.setUint16(2, length);
  if (extended === 8) {
    view.setUint32(2, Math.floor(length / 0x1_0000_0000));
    view.setUint32(6, length >>> 0);
  }
  frame.set(payload, 2 + extended + maskBytes);
  return frame;
}

/** Reads a masked client frame back: FIN, opcode, mask bit and the unmasked payload. */
function unmaskClientFrame(frame: Uint8Array): { fin: boolean; opcode: number; masked: boolean; payload: Uint8Array } {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let length = frame[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = view.getUint16(2);
    offset = 4;
  } else if (length === 127) {
    length = view.getUint32(2) * 0x1_0000_0000 + view.getUint32(6);
    offset = 10;
  }
  const mask = frame.subarray(offset, offset + 4);
  const payload = frame.slice(offset + 4, offset + 4 + length).map((byte, i) => byte ^ mask[i & 3]);
  expect(frame.length).toBe(offset + 4 + length);
  return { fin: (frame[0] & 0x80) !== 0, opcode: frame[0] & 0x0f, masked: (frame[1] & 0x80) !== 0, payload };
}

function expectCloseCode(fn: () => unknown, closeCode: number): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(WsProtocolError);
  expect((caught as WsProtocolError).closeCode).toBe(closeCode);
}

describe('opening handshake values', () => {
  it('computes the RFC 6455 §1.3 accept example', () => {
    expect(acceptFor('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('draws a fresh 16-byte base64 key each time', () => {
    const key = websocketKey(webCrypto);
    expect(key).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(websocketKey(webCrypto)).not.toBe(key);
  });
});

describe('encodeClientFrame', () => {
  const mask = Uint8Array.of(0x12, 0x34, 0x56, 0x78);

  it.each([5, 126, 70_000])('masks a %i-byte payload that decodes back', (length) => {
    const payload = Uint8Array.from({ length }, (_, i) => i % 251);
    const frame = encodeClientFrame(OPCODES.binary, payload, mask);
    const decoded = unmaskClientFrame(frame);
    expect(decoded).toMatchObject({ fin: true, opcode: OPCODES.binary, masked: true });
    expect(decoded.payload).toEqual(payload);
    expect(frame[1] & 0x7f).toBe(length < 126 ? length : length < 0x10000 ? 126 : 127);
  });

  it('clears FIN for a non-final frame and rejects a mask that is not 4 bytes', () => {
    expect(encodeClientFrame(OPCODES.text, bytes('a'), mask, false)[0] & 0x80).toBe(0);
    expect(() => encodeClientFrame(OPCODES.text, bytes('a'), Uint8Array.of(1, 2, 3))).toThrow(TypeError);
  });
});

describe('close payloads', () => {
  it('round-trips a code and a UTF-8 reason', () => {
    expect(decodeClosePayload(encodeClosePayload(4401, 'révoqué'))).toEqual({ code: 4401, reason: 'révoqué' });
  });

  it('reads an empty payload as 1005 and encodes no code as empty', () => {
    expect(encodeClosePayload().length).toBe(0);
    expect(decodeClosePayload(new Uint8Array(0))).toEqual({ code: 1005, reason: '' });
  });

  it('rejects a one-byte payload and reserved codes with 1002', () => {
    expectCloseCode(() => decodeClosePayload(Uint8Array.of(3)), 1002);
    for (const code of [999, 1004, 1005, 1006, 1015, 2999, 5000]) {
      expectCloseCode(() => decodeClosePayload(encodeClosePayload(code)), 1002);
    }
  });

  it('rejects a reason that is not UTF-8 with 1007', () => {
    expectCloseCode(() => decodeClosePayload(Uint8Array.of(0x03, 0xe8, 0xff)), 1007);
  });
});

describe('FrameDecoder', () => {
  /** Feeds `input` one byte at a time and collects every event. */
  function byteByByte(decoder: FrameDecoder, input: Uint8Array) {
    return Array.from(input).flatMap((byte) => decoder.push(Uint8Array.of(byte)));
  }

  it('decodes text and binary messages of every length form, whole and byte by byte', () => {
    const big = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    const input = Uint8Array.from([
      ...serverFrame(OPCODES.text, bytes('hello')),
      ...serverFrame(OPCODES.binary, big.subarray(0, 300)),
      ...serverFrame(OPCODES.binary, big),
    ]);
    const expected = [
      { type: 'text', data: 'hello' },
      { type: 'binary', data: big.slice(0, 300) },
      { type: 'binary', data: big },
    ];
    expect(new FrameDecoder().push(input)).toEqual(expected);
    expect(byteByByte(new FrameDecoder(), input)).toEqual(expected);
  });

  it('reassembles a three-frame text message and delivers a ping between fragments in order', () => {
    const input = Uint8Array.from([
      ...serverFrame(OPCODES.text, bytes('Hel'), { fin: false }),
      ...serverFrame(OPCODES.ping, bytes('p')),
      ...serverFrame(OPCODES.continuation, bytes('lo, '), { fin: false }),
      ...serverFrame(OPCODES.continuation, bytes('wörld')),
    ]);
    const expected = [
      { type: 'ping', data: bytes('p') },
      { type: 'text', data: 'Hello, wörld' },
    ];
    expect(new FrameDecoder().push(input)).toEqual(expected);
    expect(byteByByte(new FrameDecoder(), input)).toEqual(expected);
  });

  it('reads a close frame and ignores bytes after it', () => {
    const decoder = new FrameDecoder();
    const input = Uint8Array.from([
      ...serverFrame(OPCODES.pong, bytes('x')),
      ...serverFrame(OPCODES.close, encodeClosePayload(4401, 'revoked')),
      ...serverFrame(OPCODES.text, bytes('late')),
    ]);
    expect(decoder.push(input)).toEqual([
      { type: 'pong', data: bytes('x') },
      { type: 'close', code: 4401, reason: 'revoked' },
    ]);
    expect(decoder.push(serverFrame(OPCODES.text, bytes('later')))).toEqual([]);
  });

  describe('protocol errors', () => {
    const fails = (input: Uint8Array, closeCode: number, options = {}): void =>
      expectCloseCode(() => new FrameDecoder(options).push(input), closeCode);

    it('1002 for a masked server frame', () => fails(serverFrame(OPCODES.text, bytes('a'), { masked: true }), 1002));
    it('1002 for non-zero RSV bits', () => fails(serverFrame(OPCODES.text, bytes('a'), { rsv: 4 }), 1002));
    it('1002 for an unknown opcode', () => fails(serverFrame(0x3, bytes('a')), 1002));
    it('1002 for a control frame over 125 bytes', () => fails(serverFrame(OPCODES.ping, new Uint8Array(126)), 1002));
    it('1002 for a control frame without FIN', () => fails(serverFrame(OPCODES.ping, bytes('a'), { fin: false }), 1002));
    it('1002 for a continuation with no message in progress', () => fails(serverFrame(OPCODES.continuation, bytes('a')), 1002));
    it('1002 for a new data frame inside a fragmented message', () =>
      fails(
        Uint8Array.from([
          ...serverFrame(OPCODES.text, bytes('a'), { fin: false }),
          ...serverFrame(OPCODES.binary, bytes('b')),
        ]),
        1002,
      ));
    it('1002 for a 64-bit length with the top bit set', () =>
      fails(Uint8Array.of(0x82, 127, 0x80, 0, 0, 0, 0, 0, 0, 1), 1002));
    it('1007 for text that is not UTF-8', () => fails(serverFrame(OPCODES.text, Uint8Array.of(0xc3, 0x28)), 1007));
    it('1009 for a message over maxMessageBytes, single and fragmented', () => {
      fails(serverFrame(OPCODES.binary, new Uint8Array(5)), 1009, { maxMessageBytes: 4 });
      fails(
        Uint8Array.from([
          ...serverFrame(OPCODES.binary, new Uint8Array(3), { fin: false }),
          ...serverFrame(OPCODES.continuation, new Uint8Array(3)),
        ]),
        1009,
        { maxMessageBytes: 4 },
      );
    });
    it('1002 for a close frame with an invalid code', () =>
      fails(serverFrame(OPCODES.close, encodeClosePayload(1006)), 1002));
  });
});
