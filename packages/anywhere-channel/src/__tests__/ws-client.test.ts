/** PAN-4834 WI-4: the browser WebSocket interface over a dedicated channel. */
import { type Duplex, duplexPair } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChannelCloseEvent, ChannelMessageEvent, ChannelWebSocket } from '../ws-client.js';
import { acceptFor, encodeClosePayload, OPCODES } from '../ws-frames.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const open: Duplex[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const stream of open.splice(0)) stream.destroy();
});

/** Lets stream callbacks (nextTick and setImmediate, which stay real) run until `done()` holds. */
async function until(done: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns && !done(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
  if (!done()) throw new Error('condition never held');
}

interface ClientFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payload: Uint8Array;
}

/** The server end of one channel: reads the upgrade request, then masked client frames. */
class ScriptedServer {
  request: { line: string; headers: Map<string, string> } | null = null;
  readonly frames: ClientFrame[] = [];
  onRequest: (server: ScriptedServer) => void = (server) => server.accept();
  onFrame: (frame: ClientFrame, server: ScriptedServer) => void = () => {};
  private buf = new Uint8Array(0);

  constructor(readonly stream: Duplex) {
    stream.on('data', (chunk: Buffer) => this.onData(new Uint8Array(chunk)));
  }

  /** A 101 answer with the right accept key, `extra` header lines and an optional first frame behind it. */
  accept(options: { protocol?: string; acceptKey?: string; trailing?: Uint8Array } = {}): void {
    const key = this.request!.headers.get('sec-websocket-key')!;
    const lines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${options.acceptKey ?? acceptFor(key)}`,
      ...(options.protocol ? [`Sec-WebSocket-Protocol: ${options.protocol}`] : []),
    ];
    const head = encoder.encode(`${lines.join('\r\n')}\r\n\r\n`);
    this.stream.write(options.trailing ? Buffer.concat([head, options.trailing]) : head);
  }

  send(opcode: number, payload: Uint8Array | string): void {
    this.stream.write(serverFrame(opcode, typeof payload === 'string' ? encoder.encode(payload) : payload));
  }

  private onData(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    if (!this.request) {
      const text = decoder.decode(this.buf);
      const end = text.indexOf('\r\n\r\n');
      if (end < 0) return;
      const [line, ...rest] = text.slice(0, end).split('\r\n');
      const headers = new Map(rest.map((h) => [h.slice(0, h.indexOf(':')).toLowerCase(), h.slice(h.indexOf(':') + 1).trim()]));
      this.request = { line, headers };
      this.buf = this.buf.slice(end + 4);
      this.onRequest(this);
    }
    for (;;) {
      const frame = readClientFrame(this.buf);
      if (!frame) return;
      this.buf = this.buf.slice(frame.end);
      this.frames.push(frame.frame);
      this.onFrame(frame.frame, this);
    }
  }
}

function serverFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const length = payload.length;
  const extended = length < 126 ? 0 : length < 0x10000 ? 2 : 8;
  const frame = new Uint8Array(2 + extended + length);
  frame[0] = 0x80 | opcode;
  frame[1] = extended === 0 ? length : extended === 2 ? 126 : 127;
  if (extended === 2) new DataView(frame.buffer).setUint16(2, length);
  if (extended === 8) new DataView(frame.buffer).setUint32(6, length);
  frame.set(payload, 2 + extended);
  return frame;
}

function readClientFrame(buf: Uint8Array): { frame: ClientFrame; end: number } | null {
  if (buf.length < 2) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let offset = 2;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (length === 126) {
    if (buf.length < 4) return null;
    length = view.getUint16(2);
    offset = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    length = view.getUint32(6);
    offset = 10;
  }
  const maskLength = masked ? 4 : 0;
  if (buf.length < offset + maskLength + length) return null;
  const mask = buf.subarray(offset, offset + maskLength);
  const payload = buf.slice(offset + maskLength, offset + maskLength + length).map((byte, i) => (masked ? byte ^ mask[i & 3] : byte));
  return { frame: { fin: (buf[0] & 0x80) !== 0, opcode: buf[0] & 0x0f, masked, payload }, end: offset + maskLength + length };
}

/** A socket wired to a fresh scripted server; `events` records every dispatched event in order. */
function connect(options: { protocols?: string | string[]; setup?: (server: ScriptedServer) => void; closeTimeoutMs?: number } = {}) {
  let server: ScriptedServer | null = null;
  const dial = vi.fn(async () => {
    const [client, peer] = duplexPair();
    client.once('close', () => peer.destroy());
    peer.once('close', () => client.destroy());
    open.push(client, peer);
    server = new ScriptedServer(peer);
    options.setup?.(server);
    return client;
  });
  const socket = new ChannelWebSocket('ws://localhost/ws/rpc?x=1', options.protocols, {
    dial,
    bearerToken: 't',
    closeTimeoutMs: options.closeTimeoutMs,
  });
  const events: Event[] = [];
  for (const type of ['open', 'message', 'error', 'close']) socket.addEventListener(type, (event) => events.push(event));
  return { socket, events, dial, server: () => server! };
}

const types = (events: Event[]): string[] => events.map((event) => event.type);
const closeOf = (events: Event[]): ChannelCloseEvent => events.find((event) => event.type === 'close') as ChannelCloseEvent;

describe('ChannelWebSocket', () => {
  it('opens with the chosen subprotocol and sends the channel upgrade headers', async () => {
    const { socket, events, server } = connect({
      protocols: ['a', 'b'],
      setup: (s) => {
        s.onRequest = (srv) => srv.accept({ protocol: 'b' });
      },
    });
    expect(socket.readyState).toBe(ChannelWebSocket.CONNECTING);
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    expect(types(events)).toEqual(['open']);
    expect(socket.protocol).toBe('b');
    expect(socket.url).toBe('ws://localhost/ws/rpc?x=1');
    const { line, headers } = server().request!;
    expect(line).toBe('GET /ws/rpc?x=1 HTTP/1.1');
    expect(headers.get('authorization')).toBe('Bearer t');
    expect(headers.get('host')).toBe('link.invalid');
    expect(headers.get('sec-websocket-protocol')).toBe('a, b');
    expect(headers.get('sec-websocket-version')).toBe('13');
    expect(headers.has('origin')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });

  it.each([
    ['a wrong Sec-WebSocket-Accept', (s: ScriptedServer) => s.accept({ acceptKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA=' })],
    ['a 403 answer', (s: ScriptedServer) => s.stream.write('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')],
    ['an unoffered subprotocol', (s: ScriptedServer) => s.accept({ protocol: 'evil' })],
  ])('fires error then close 1006 for %s', async (_label, respond) => {
    const { socket, events, server } = connect({
      setup: (s) => {
        s.onRequest = respond;
      },
    });
    await until(() => socket.readyState === ChannelWebSocket.CLOSED);
    expect(types(events)).toEqual(['error', 'close']);
    expect(closeOf(events)).toMatchObject({ code: 1006, reason: '', wasClean: false });
    await until(() => server().stream.destroyed);
  });

  it('fires error then close 1006 when the dial fails', async () => {
    const socket = new ChannelWebSocket('ws://localhost/ws/rpc', undefined, {
      dial: async () => {
        throw new Error('relay unreachable');
      },
      bearerToken: 't',
    });
    const events: Event[] = [];
    for (const type of ['open', 'error', 'close']) socket.addEventListener(type, (event) => events.push(event));
    await until(() => events.length === 2);
    expect(types(events)).toEqual(['error', 'close']);
    expect((events[1] as ChannelCloseEvent).code).toBe(1006);
  });

  it('delivers text, Blob and ArrayBuffer messages', async () => {
    const { socket, events, server } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    server().send(OPCODES.text, 'hello');
    server().send(OPCODES.binary, Uint8Array.of(1, 2, 3));
    await until(() => events.length === 3);
    socket.binaryType = 'arraybuffer';
    server().send(OPCODES.binary, Uint8Array.of(4, 5));
    await until(() => events.length === 4);
    const messages = events.slice(1) as ChannelMessageEvent[];
    expect(messages[0].data).toBe('hello');
    expect(messages[1].data).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (messages[1].data as Blob).arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3));
    expect(messages[2].data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(messages[2].data as ArrayBuffer)).toEqual(Uint8Array.of(4, 5));
  });

  it('delivers a frame that arrived right behind the 101', async () => {
    const { events } = connect({
      setup: (s) => {
        s.onRequest = (srv) => srv.accept({ trailing: serverFrame(OPCODES.text, encoder.encode('first')) });
      },
    });
    await until(() => events.length === 2);
    expect(types(events)).toEqual(['open', 'message']);
    expect((events[1] as ChannelMessageEvent).data).toBe('first');
  });

  it('masks every client frame', async () => {
    const { socket, server } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    socket.send('hi');
    socket.send(Uint8Array.of(9, 8, 7).subarray(1));
    socket.send(Uint8Array.of(6).buffer);
    await until(() => server().frames.length === 3);
    expect(server().frames.every((frame) => frame.masked && frame.fin)).toBe(true);
    expect(server().frames.map((frame) => frame.opcode)).toEqual([OPCODES.text, OPCODES.binary, OPCODES.binary]);
    expect(decoder.decode(server().frames[0].payload)).toBe('hi');
    expect(server().frames[1].payload).toEqual(Uint8Array.of(8, 7));
    expect(server().frames[2].payload).toEqual(Uint8Array.of(6));
  });

  it('answers a ping with a pong carrying the same payload', async () => {
    const { socket, server } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    server().send(OPCODES.ping, 'beat');
    await until(() => server().frames.length === 1);
    expect(server().frames[0].opcode).toBe(OPCODES.pong);
    expect(server().frames[0].masked).toBe(true);
    expect(decoder.decode(server().frames[0].payload)).toBe('beat');
  });

  it('surfaces a server close 4401 and echoes it', async () => {
    const { socket, events, server } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    server().send(OPCODES.close, encodeClosePayload(4401, 'revoked'));
    await until(() => socket.readyState === ChannelWebSocket.CLOSED);
    expect(types(events)).toEqual(['open', 'close']);
    expect(closeOf(events)).toMatchObject({ code: 4401, reason: 'revoked', wasClean: true });
    await until(() => server().frames.length === 1);
    expect(server().frames[0].opcode).toBe(OPCODES.close);
    expect(server().frames[0].payload).toEqual(encodeClosePayload(4401));
  });

  it('completes a client close(1000) on the server echo', async () => {
    const { socket, events } = connect({
      setup: (s) => {
        s.onFrame = (frame, srv) => {
          if (frame.opcode === OPCODES.close) setImmediate(() => srv.send(OPCODES.close, frame.payload));
        };
      },
    });
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    socket.close(1000, 'bye');
    expect(socket.readyState).toBe(ChannelWebSocket.CLOSING);
    socket.send('dropped');
    await until(() => socket.readyState === ChannelWebSocket.CLOSED);
    expect(closeOf(events)).toMatchObject({ code: 1000, reason: 'bye', wasClean: true });
    expect(types(events)).toEqual(['open', 'close']);
  });

  it('closes cleanly when the echo and the channel end arrive synchronously', async () => {
    const { socket, events } = connect({
      setup: (s) => {
        s.onFrame = (frame, srv) => {
          if (frame.opcode !== OPCODES.close) return;
          srv.send(OPCODES.close, frame.payload);
          srv.stream.end();
        };
      },
    });
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    socket.close(1000);
    await until(() => socket.readyState === ChannelWebSocket.CLOSED);
    expect(types(events)).toEqual(['open', 'close']);
    expect(closeOf(events)).toMatchObject({ code: 1000, wasClean: true });
  });

  it('closes 1006 after the close timeout when the server never echoes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { socket, events } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    socket.close(1000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(socket.readyState).toBe(ChannelWebSocket.CLOSING);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.readyState).toBe(ChannelWebSocket.CLOSED);
    expect(closeOf(events)).toMatchObject({ code: 1006, wasClean: false });
    expect(types(events).filter((type) => type === 'close')).toHaveLength(1);
  });

  it('fires error then close 1006 when the channel ends without a close frame', async () => {
    const { socket, events, server } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    server().stream.destroy();
    await until(() => socket.readyState === ChannelWebSocket.CLOSED);
    expect(types(events)).toEqual(['open', 'error', 'close']);
    expect(closeOf(events)).toMatchObject({ code: 1006, wasClean: false });
  });

  it('fails with a 1002 close frame on a protocol error', async () => {
    const { socket, events, server } = connect();
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    server().send(0x3, 'bad opcode');
    await until(() => socket.readyState === ChannelWebSocket.CLOSED);
    expect(types(events)).toEqual(['open', 'error', 'close']);
    expect(closeOf(events).code).toBe(1006);
  });

  it('throws InvalidStateError for send while connecting and InvalidAccessError for close(1001)', async () => {
    const { socket } = connect();
    expect(() => socket.send('early')).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
    expect(() => socket.close(1001)).toThrow(expect.objectContaining({ name: 'InvalidAccessError' }));
    expect(() => socket.close(1000, 'x'.repeat(124))).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    expect(() => socket.send(new Blob(['x']))).toThrow(TypeError);
  });

  it('rejects relative URLs and invalid subprotocols with SyntaxError', () => {
    const options = { dial: vi.fn(), bearerToken: 't' };
    expect(() => new ChannelWebSocket('/ws/rpc', undefined, options)).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(() => new ChannelWebSocket('ws://h/ws', ['a', 'a'], options)).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(() => new ChannelWebSocket('ws://h/ws', 'bad proto', options)).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(options.dial).not.toHaveBeenCalled();
  });

  it('fails a close() during CONNECTING and destroys the channel when it arrives', async () => {
    const { socket, events, dial } = connect();
    socket.close();
    expect(socket.readyState).toBe(ChannelWebSocket.CLOSED);
    expect(types(events)).toEqual(['error', 'close']);
    await until(() => dial.mock.results.length === 1);
    const channel = (await dial.mock.results[0].value) as Duplex;
    await until(() => channel.destroyed);
  });

  it('supports once listeners and the on* handler properties the way Effect uses them', async () => {
    const { socket, server } = connect();
    const onceOpen = vi.fn();
    socket.addEventListener('open', onceOpen, { once: true });
    const onmessage = vi.fn();
    const replaced = vi.fn();
    socket.onmessage = replaced;
    socket.onmessage = onmessage;
    const onclose = vi.fn();
    socket.onclose = onclose;
    await until(() => socket.readyState === ChannelWebSocket.OPEN);
    server().send(OPCODES.text, 'one');
    server().send(OPCODES.text, 'two');
    await until(() => onmessage.mock.calls.length === 2);
    expect(onceOpen).toHaveBeenCalledTimes(1);
    expect(replaced).not.toHaveBeenCalled();
    expect(onmessage.mock.calls.map(([event]) => (event as ChannelMessageEvent).data)).toEqual(['one', 'two']);
    expect(ChannelWebSocket.OPEN).toBe(1);
    expect(socket.CLOSED).toBe(3);
    server().send(OPCODES.close, encodeClosePayload(1000));
    await until(() => onclose.mock.calls.length === 1);
    expect((onclose.mock.calls[0][0] as ChannelCloseEvent).code).toBe(1000);
  });
});
