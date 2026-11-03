/**
 * `ChannelWebSocket`: the browser `WebSocket` interface over a secure channel
 * (PAN-4834 WI-4). The page shims construct it for `/ws/*` URLs, so Effect's
 * `Socket.layerWebSocket` drives the machine's `/ws/rpc` through the channel.
 *
 * Each socket dials its own channel (D-4): the upgrade consumes the HTTP
 * connection, so it never borrows from the request pool. The client follows
 * browser semantics wherever the frontend can tell (D-8): `binaryType`
 * defaults to `'blob'`, an abnormal end fires `error` and then `close` 1006,
 * and `close` fires exactly once. Not supported, by design (D-9): sending a
 * `Blob`, extensions, and a meaningful `bufferedAmount`.
 */
import type { CryptoPort } from './crypto-port.js';
import { webCrypto } from './crypto-web.js';
import type { ChannelDial, ChannelStream } from './http-client.js';
import { CHANNEL_HOST, type HeaderPairs, type HttpResponse, ResponseParser, serializeHead } from './http1.js';
import {
  acceptFor,
  encodeClientFrame,
  encodeClosePayload,
  FrameDecoder,
  type Opcode,
  OPCODES,
  websocketKey,
  type WsEvent,
  WsProtocolError,
} from './ws-frames.js';

export interface ChannelWebSocketOptions {
  dial: ChannelDial;
  /** The machine's phone token, sent as `Authorization: Bearer <token>` on the upgrade. */
  bearerToken: string;
  crypto?: CryptoPort;
  /** How long a client-initiated close waits for the server's close frame. */
  closeTimeoutMs?: number;
}

const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_CLOSE_REASON_BYTES = 123;

const encoder = new TextEncoder();

/** A `message` event; Node 22 has `MessageEvent`, but the class stays local for one shape everywhere. */
export class ChannelMessageEvent extends Event {
  readonly origin = '';
  constructor(
    type: string,
    readonly data: string | Blob | ArrayBuffer,
  ) {
    super(type);
  }
}

/** A `close` event; Node 22 has no global `CloseEvent` (PAN-4834 Fact 10). */
export class ChannelCloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  constructor(type: string, init: { code: number; reason: string; wasClean: boolean }) {
    super(type);
    this.code = init.code;
    this.reason = init.reason;
    this.wasClean = init.wasClean;
  }
}

type ReadyState = 0 | 1 | 2 | 3;
type HandlerType = 'open' | 'message' | 'close' | 'error';
type Handler<E extends Event> = ((this: ChannelWebSocket, event: E) => unknown) | null;

export class ChannelWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readonly extensions = '';
  readonly bufferedAmount = 0;

  private state: ReadyState = 0;
  private selectedProtocol = '';
  private type: BinaryType = 'blob';
  private readonly handlers: Record<HandlerType, Handler<Event> | null> = {
    open: null,
    message: null,
    close: null,
    error: null,
  };
  private readonly crypto: CryptoPort;
  private readonly closeTimeoutMs: number;
  private stream: ChannelStream | null = null;
  private decoder: FrameDecoder | null = null;
  private closeSent = false;
  private closeDispatched = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string | URL, protocols: string | string[] | undefined, private readonly options: ChannelWebSocketOptions) {
    super();
    let parsed: URL;
    try {
      parsed = new URL(String(url));
    } catch {
      throw new DOMException(`The URL '${String(url)}' is invalid.`, 'SyntaxError');
    }
    const offered = protocols === undefined ? [] : typeof protocols === 'string' ? [protocols] : [...protocols];
    if (offered.some((protocol) => !TOKEN.test(protocol)) || new Set(offered).size !== offered.length) {
      throw new DOMException(`The subprotocols ${JSON.stringify(offered)} are invalid.`, 'SyntaxError');
    }
    this.url = parsed.href;
    this.crypto = options.crypto ?? webCrypto;
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    for (const type of Object.keys(this.handlers) as HandlerType[]) {
      this.addEventListener(type, (event) => this.handlers[type]?.call(this, event));
    }
    void this.connect(parsed.pathname + parsed.search, offered);
  }

  get readyState(): ReadyState {
    return this.state;
  }

  get protocol(): string {
    return this.selectedProtocol;
  }

  get binaryType(): BinaryType {
    return this.type;
  }

  set binaryType(value: BinaryType) {
    if (value === 'blob' || value === 'arraybuffer') this.type = value;
  }

  get onopen(): Handler<Event> {
    return this.handlers.open;
  }
  set onopen(handler: Handler<Event>) {
    this.handlers.open = handler;
  }
  get onmessage(): Handler<ChannelMessageEvent> {
    return this.handlers.message as Handler<ChannelMessageEvent>;
  }
  set onmessage(handler: Handler<ChannelMessageEvent>) {
    this.handlers.message = handler as Handler<Event>;
  }
  get onclose(): Handler<ChannelCloseEvent> {
    return this.handlers.close as Handler<ChannelCloseEvent>;
  }
  set onclose(handler: Handler<ChannelCloseEvent>) {
    this.handlers.close = handler as Handler<Event>;
  }
  get onerror(): Handler<Event> {
    return this.handlers.error;
  }
  set onerror(handler: Handler<Event>) {
    this.handlers.error = handler;
  }

  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void {
    if (this.state === ChannelWebSocket.CONNECTING) {
      throw new DOMException('The WebSocket is still connecting.', 'InvalidStateError');
    }
    if (this.state !== ChannelWebSocket.OPEN) return;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      throw new TypeError('Blob payloads are not supported over the channel');
    }
    if (typeof data === 'string') this.writeFrame(OPCODES.text, encoder.encode(data));
    else if (data instanceof ArrayBuffer) this.writeFrame(OPCODES.binary, new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) {
      this.writeFrame(OPCODES.binary, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else this.writeFrame(OPCODES.text, encoder.encode(String(data)));
  }

  close(code?: number, reason?: string): void {
    if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) {
      throw new DOMException(`The close code ${code} is neither 1000 nor in 3000-4999.`, 'InvalidAccessError');
    }
    if (reason !== undefined && encoder.encode(reason).length > MAX_CLOSE_REASON_BYTES) {
      throw new DOMException(`The close reason is longer than ${MAX_CLOSE_REASON_BYTES} bytes.`, 'SyntaxError');
    }
    if (this.state === ChannelWebSocket.CONNECTING) {
      this.fail();
      return;
    }
    if (this.state !== ChannelWebSocket.OPEN) return;
    // Enter CLOSING before writing: a channel can deliver the server's echo synchronously.
    this.state = ChannelWebSocket.CLOSING;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.stream?.destroy();
      this.finishClose({ code: 1006, reason: '', wasClean: false });
    }, this.closeTimeoutMs);
    this.sendClose(code, reason ?? '');
  }

  private async connect(path: string, offered: string[]): Promise<void> {
    let stream: ChannelStream;
    try {
      stream = await this.options.dial();
    } catch {
      this.fail();
      return;
    }
    if (this.state === ChannelWebSocket.CLOSED) {
      // close() ran while the channel was dialling.
      stream.destroy();
      return;
    }
    this.stream = stream;
    const key = websocketKey(this.crypto);
    const headers: HeaderPairs = [
      ['Host', CHANNEL_HOST],
      ['Upgrade', 'websocket'],
      ['Connection', 'Upgrade'],
      ['Sec-WebSocket-Key', key],
      ['Sec-WebSocket-Version', '13'],
      ['Authorization', `Bearer ${this.options.bearerToken}`],
    ];
    if (offered.length > 0) headers.push(['Sec-WebSocket-Protocol', offered.join(', ')]);
    let head: Uint8Array;
    try {
      head = serializeHead('GET', path, headers);
    } catch {
      this.fail();
      return;
    }
    const parser = new ResponseParser({ method: 'GET' });

    stream.on('data', (chunk: Uint8Array) => {
      if (this.state === ChannelWebSocket.CLOSED) return;
      if (!this.decoder) {
        try {
          const step = parser.push(chunk);
          if (step.state !== 'done') return;
          if (!this.accepts(step.response, key, offered)) {
            this.fail();
            return;
          }
          this.decoder = new FrameDecoder();
          this.selectedProtocol = header(step.response, 'sec-websocket-protocol') ?? '';
          this.state = ChannelWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
          if (step.leftover.length > 0) this.onFrames(step.leftover);
        } catch {
          this.fail();
        }
        return;
      }
      this.onFrames(chunk);
    });
    const onGone = (): void => {
      if (this.state !== ChannelWebSocket.CLOSED) this.fail();
    };
    stream.on('end', onGone);
    stream.on('close', onGone);
    stream.on('error', onGone);
    stream.write(head);
  }

  /** RFC 6455 §4.1: the server's handshake response must match what this client asked for. */
  private accepts(response: HttpResponse, key: string, offered: string[]): boolean {
    if (response.status !== 101) return false;
    if (header(response, 'upgrade')?.toLowerCase() !== 'websocket') return false;
    const connection = (header(response, 'connection') ?? '').split(',').map((token) => token.trim().toLowerCase());
    if (!connection.includes('upgrade')) return false;
    if (header(response, 'sec-websocket-accept') !== acceptFor(key)) return false;
    const protocol = header(response, 'sec-websocket-protocol');
    if (protocol !== undefined && !offered.includes(protocol)) return false;
    return header(response, 'sec-websocket-extensions') === undefined;
  }

  private onFrames(chunk: Uint8Array): void {
    let events: WsEvent[];
    try {
      events = this.decoder!.push(chunk);
    } catch (error) {
      if (error instanceof WsProtocolError) {
        this.sendClose(error.closeCode, '');
        this.fail();
        return;
      }
      throw error;
    }
    for (const event of events) {
      if (this.state === ChannelWebSocket.CLOSED) return;
      switch (event.type) {
        case 'text':
          if (this.state === ChannelWebSocket.OPEN) this.dispatchEvent(new ChannelMessageEvent('message', event.data));
          break;
        case 'binary':
          if (this.state === ChannelWebSocket.OPEN) this.dispatchEvent(new ChannelMessageEvent('message', this.binary(event.data)));
          break;
        case 'ping':
          this.writeFrame(OPCODES.pong, event.data);
          break;
        case 'pong':
          break;
        case 'close':
          this.onServerClose(event.code, event.reason);
          break;
      }
    }
  }

  private onServerClose(code: number, reason: string): void {
    // Settle first: the echo can make the server end the channel synchronously, which must not read as abnormal.
    this.finishClose({ code, reason, wasClean: true });
    if (!this.closeSent) this.sendClose(code === 1005 ? undefined : code, '');
    const stream = this.stream;
    if (stream) {
      // Let the echoed close frame reach the server; its own end (or the timeout) releases the channel.
      stream.end();
      const linger = setTimeout(() => stream.destroy(), this.closeTimeoutMs);
      const release = (): void => {
        clearTimeout(linger);
        stream.destroy();
      };
      stream.on('end', release);
      stream.on('close', release);
    }
  }

  private binary(data: Uint8Array): Blob | ArrayBuffer {
    if (this.type === 'blob') return new Blob([data as Uint8Array<ArrayBuffer>]);
    const exact = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
    return (exact ? data.buffer : data.slice().buffer) as ArrayBuffer;
  }

  private sendClose(code: number | undefined, reason: string): void {
    if (this.closeSent) return;
    this.closeSent = true;
    this.writeFrame(OPCODES.close, encodeClosePayload(code, reason));
  }

  private writeFrame(opcode: Opcode, payload: Uint8Array): void {
    const stream = this.stream;
    if (!stream || stream.destroyed) return;
    stream.write(encodeClientFrame(opcode, payload, this.crypto.randomBytes(4)));
  }

  /** Fails the connection: destroys the channel, then fires `error` and `close` 1006. */
  private fail(): void {
    if (this.closeDispatched) return;
    this.stream?.destroy();
    this.state = ChannelWebSocket.CLOSED;
    this.dispatchEvent(new Event('error'));
    this.finishClose({ code: 1006, reason: '', wasClean: false });
  }

  private finishClose(init: { code: number; reason: string; wasClean: boolean }): void {
    if (this.closeDispatched) return;
    this.closeDispatched = true;
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.state = ChannelWebSocket.CLOSED;
    this.dispatchEvent(new ChannelCloseEvent('close', init));
  }
}

function header(response: HttpResponse, name: string): string | undefined {
  const values = response.headers.filter(([key]) => key === name).map(([, value]) => value);
  return values.length === 0 ? undefined : values.join(', ');
}
