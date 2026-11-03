/**
 * `ChannelSocket` — one secure channel as a Node `stream.Duplex` (PAN-4645 WI-2).
 *
 * Wraps a `@hyperswarm/secret-stream` (XChaCha20-Poly1305 secretstream framing
 * keyed from the Noise split) over a raw transport duplex (a TCP socket or a
 * `ws` WebSocket stream). It looks enough like a `net.Socket` for Node's HTTP
 * server (`server.emit('connection', socket)`), `http.request({ createConnection })`
 * and `ws` to use it unchanged, and carries a `channel` marker naming the mode
 * and the peer's static key.
 *
 * Construction is synchronous and must happen in the same tick as the last
 * handshake message was sent or received: `leftover` carries any bytes that
 * arrived behind that message (the peer's secret-stream header can share a
 * TCP segment with it) and no byte may be read from the raw stream in between.
 *
 * `remoteAddress` is `link:<first 16 hex of the remote key>` so nothing treats
 * a channel request as loopback (D-4645-10).
 */
import { createRequire } from 'node:module';
import { Duplex } from 'node:stream';

import type { ChannelMarker, HandshakeResult } from '@overdeck/anywhere-channel';

export type { ChannelMarker, ChannelMode } from '@overdeck/anywhere-channel';

interface SecretStreamLike {
  write(chunk: Uint8Array): boolean;
  end(): void;
  destroy(error?: Error): void;
  pause(): void;
  resume(): void;
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'end' | 'close' | 'drain' | 'connect', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  once(event: 'drain' | 'close', listener: () => void): this;
  readonly destroyed: boolean;
  readonly destroying: boolean;
  rawBytesWritten: number;
}

interface SecretStreamConstructor {
  new (
    isInitiator: boolean,
    rawStream: Duplex,
    opts: {
      handshake: { tx: Uint8Array; rx: Uint8Array; hash: Uint8Array; publicKey: Uint8Array; remotePublicKey: Uint8Array };
      data?: Uint8Array;
    },
  ): SecretStreamLike;
}

const _require = createRequire(import.meta.url);
const SecretStream = _require('@hyperswarm/secret-stream') as SecretStreamConstructor;

const CHANNEL_SOCKET = Symbol.for('overdeck.anywhere.channelSocket');

export interface CreateChannelSocketOptions {
  raw: Duplex;
  /** True on the side that opened the transport connection. */
  initiator: boolean;
  handshake: HandshakeResult;
  channel: ChannelMarker;
  /** Bytes already read from `raw` behind the last handshake frame. */
  leftover?: Uint8Array;
}

interface RawTransport extends Duplex {
  setNoDelay?: (noDelay?: boolean) => unknown;
  setKeepAlive?: (enable?: boolean, initialDelay?: number) => unknown;
  ref?: () => unknown;
  unref?: () => unknown;
}

export class ChannelSocket extends Duplex {
  readonly [CHANNEL_SOCKET] = true;
  readonly channel: ChannelMarker;
  readonly remoteAddress: string;
  readonly remoteFamily = 'link';
  readonly remotePort = 0;
  /**
   * Ciphertext bytes received since the handshake completed (counted before
   * secret-stream's in-place decryption; handshake bytes are not included).
   */
  bytesIn = 0;
  /** Ciphertext bytes written since the handshake completed. */
  bytesOut = 0;

  private readonly secret: SecretStreamLike;
  private readonly raw: RawTransport;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleMs = 0;

  constructor(options: CreateChannelSocketOptions) {
    super({ allowHalfOpen: false });
    this.channel = options.channel;
    this.remoteAddress = `link:${options.channel.remoteKeyHex.slice(0, 16)}`;
    this.raw = options.raw as RawTransport;
    this.bytesIn = options.leftover?.length ?? 0;

    // Count ciphertext ahead of secret-stream's own listener: it decrypts in place.
    this.raw.prependListener('data', (chunk: Buffer | string) => {
      this.bytesIn += Buffer.byteLength(chunk);
      this.touch();
    });
    const rawWrite = this.raw.write.bind(this.raw) as (chunk: unknown, ...rest: unknown[]) => boolean;
    this.raw.write = ((chunk: Buffer | string, ...rest: unknown[]): boolean => {
      this.bytesOut += Buffer.byteLength(chunk);
      return rawWrite(chunk, ...rest);
    }) as typeof this.raw.write;

    const { handshake } = options;
    this.secret = new SecretStream(options.initiator, options.raw, {
      handshake: {
        tx: handshake.tx,
        rx: handshake.rx,
        hash: handshake.hash,
        publicKey: handshake.localPublicKey,
        remotePublicKey: handshake.remotePublicKey,
      },
      ...(options.leftover && options.leftover.length > 0 ? { data: options.leftover } : {}),
    });

    this.secret.on('data', (chunk) => {
      this.touch();
      if (!this.push(chunk)) this.secret.pause();
    });
    this.secret.on('end', () => {
      this.push(null);
    });
    this.secret.on('error', (error) => {
      this.destroy(error);
    });
    this.secret.on('close', () => {
      if (!this.destroyed) this.destroy();
    });
  }

  override _read(): void {
    this.secret.resume();
  }

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.secret.destroyed || this.secret.destroying) {
      callback(new Error('Channel is closed'));
      return;
    }
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
    this.touch();
    // secret-stream frames each write atomically (max 16 MiB); Node HTTP chunks stay far below that.
    if (this.secret.write(bytes)) {
      callback();
      return;
    }
    this.secret.once('drain', () => callback());
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.secret.end();
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.clearIdle();
    // secret-stream destroys the raw transport itself (`_predestroy`).
    if (!this.secret.destroyed) this.secret.destroy(error ?? undefined);
    callback(error);
  }

  /** The idle timeout in force (`net.Socket.timeout`); `http.Agent` reads it when pooling. */
  get timeout(): number {
    return this.idleMs;
  }

  /** Idle timeout with `net.Socket` semantics: `0` disables, otherwise `'timeout'` fires after `ms` without traffic. */
  setTimeout(ms: number, callback?: () => void): this {
    this.clearIdle();
    this.idleMs = ms > 0 ? ms : 0;
    if (callback) this.once('timeout', callback);
    if (this.idleMs > 0) this.armIdle();
    return this;
  }

  setNoDelay(noDelay?: boolean): this {
    this.raw.setNoDelay?.(noDelay);
    return this;
  }

  setKeepAlive(enable?: boolean, initialDelay?: number): this {
    this.raw.setKeepAlive?.(enable, initialDelay);
    return this;
  }

  ref(): this {
    this.raw.ref?.();
    return this;
  }

  unref(): this {
    this.raw.unref?.();
    return this;
  }

  /** Like `net.Socket`, traffic after a `'timeout'` arms the timer again (PAN-4740). */
  private touch(): void {
    if (this.idleTimer) this.idleTimer.refresh();
    else if (this.idleMs > 0 && !this.destroyed) this.armIdle();
  }

  private armIdle(): void {
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.emit('timeout');
    }, this.idleMs);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

export function createChannelSocket(options: CreateChannelSocketOptions): ChannelSocket {
  return new ChannelSocket(options);
}

export function isChannelSocket(value: unknown): value is ChannelSocket {
  return typeof value === 'object' && value !== null
    && (value as { [CHANNEL_SOCKET]?: unknown })[CHANNEL_SOCKET] === true;
}
