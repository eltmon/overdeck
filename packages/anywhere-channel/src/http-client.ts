/**
 * HTTP/1.1 requests over secure channels, and the phone's keep-alive pool
 * (PAN-4834 WI-2). The phone's equivalent of the machine-side `LinkAgent`
 * (`src/lib/anywhere/link-client.ts`).
 *
 * One channel carries one HTTP/1.1 connection, one request at a time. The
 * pool keeps at most {@link CHANNEL_POOL_MAX} channels to one machine and
 * closes a channel that idles for {@link CHANNEL_POOL_IDLE_MS}: the machine's
 * HTTP server closes an idle connection after 5 s, so the phone lets go first.
 * When the phone loses that race anyway, a `GET`, `HEAD` or `OPTIONS` that
 * died on a reused channel before any response byte is resent once on a fresh
 * channel (PAN-4740).
 */
import {
  type HttpRequest,
  type HttpResponse,
  HttpParseError,
  ResponseParser,
  serializeRequest,
} from './http1.js';

/** The plaintext side of one secure channel; a streamx or Node Duplex satisfies it. */
export interface ChannelStream {
  write(chunk: Uint8Array): boolean;
  /** The optional argument lets streamx's `end(data)` typing satisfy the interface. */
  end(data?: unknown): unknown;
  destroy(error?: Error): void;
  readonly destroyed: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

export type ChannelDial = () => Promise<ChannelStream>;

export type ChannelHttpErrorCode = 'channel-closed' | 'parse' | 'dial-failed' | 'pool-closed';

export class ChannelHttpError extends Error {
  constructor(
    readonly code: ChannelHttpErrorCode,
    message: string,
    /** True when any response byte arrived before the failure. */
    readonly responded: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ChannelHttpError';
  }
}

export const CHANNEL_POOL_MAX = 4;
export const CHANNEL_POOL_IDLE_MS = 4_000;

/** Methods a stale pooled channel may resend: they change nothing on the machine. */
const RETRY_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ChannelRequestOptions {
  signal?: AbortSignal;
}

export interface ChannelRequestResult {
  response: HttpResponse;
  /** The channel can carry another request. */
  reusable: boolean;
  keepAliveTimeoutMs: number | null;
}

/** The rejection for an aborted request (PAN-4834 D-10). */
export function abortReason(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  if (reason instanceof Error || reason instanceof DOMException) return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Sends one request on `stream` and resolves with the whole response. Every
 * listener it adds is removed when it settles, so the next request on the
 * same channel starts clean. A parse error, an `error` event or an abort
 * destroys the stream.
 */
export function requestOnChannel(
  stream: ChannelStream,
  req: HttpRequest,
  opts: ChannelRequestOptions = {},
): Promise<ChannelRequestResult> {
  const { signal } = opts;
  return new Promise<ChannelRequestResult>((resolve, reject) => {
    const bytes = serializeRequest(req);
    if (signal?.aborted) {
      stream.destroy();
      reject(abortReason(signal));
      return;
    }
    if (stream.destroyed) {
      reject(new ChannelHttpError('channel-closed', 'The channel is already closed', false));
      return;
    }
    const parser = new ResponseParser({ method: req.method });
    let settled = false;

    const cleanup = (): void => {
      settled = true;
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('close', onEnd);
      stream.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown, destroy: boolean): void => {
      cleanup();
      if (destroy) stream.destroy();
      reject(error);
    };
    const parseFailure = (error: HttpParseError): ChannelHttpError =>
      new ChannelHttpError('parse', `Malformed HTTP response: ${error.message}`, parser.responded, { cause: error });

    function onData(chunk: Uint8Array): void {
      if (settled) return;
      try {
        const step = parser.push(chunk);
        if (step.state !== 'done') return;
        cleanup();
        resolve({
          response: step.response,
          reusable: step.keepAlive && step.leftover.length === 0 && !stream.destroyed,
          keepAliveTimeoutMs: step.keepAliveTimeoutMs,
        });
      } catch (error) {
        fail(error instanceof HttpParseError ? parseFailure(error) : error, true);
      }
    }
    function onEnd(): void {
      if (settled) return;
      try {
        const step = parser.end();
        if (step.state !== 'done') throw new HttpParseError('truncated', 'The channel ended mid-response');
        cleanup();
        resolve({ response: step.response, reusable: false, keepAliveTimeoutMs: step.keepAliveTimeoutMs });
      } catch (error) {
        if (error instanceof HttpParseError && error.code === 'truncated') {
          fail(
            new ChannelHttpError('channel-closed', 'The channel closed before the response was complete', parser.responded, {
              cause: error,
            }),
            false,
          );
        } else {
          fail(error instanceof HttpParseError ? parseFailure(error) : error, true);
        }
      }
    }
    function onError(error: Error): void {
      if (settled) return;
      fail(new ChannelHttpError('channel-closed', `The channel failed: ${error.message}`, parser.responded, { cause: error }), true);
    }
    function onAbort(): void {
      if (settled || !signal) return;
      fail(abortReason(signal), true);
    }

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('close', onEnd);
    stream.on('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.write(bytes);
  });
}

export interface ChannelPoolOptions {
  dial: ChannelDial;
  max?: number;
  idleMs?: number;
}

export interface ChannelPool {
  request(req: HttpRequest, opts?: ChannelRequestOptions): Promise<HttpResponse>;
  /** Destroys every channel and rejects queued and later requests with `pool-closed`. */
  close(): void;
  /** Channels open or being dialled: busy plus idle. */
  readonly size: number;
  readonly idleCount: number;
}

interface PooledChannel {
  stream: ChannelStream;
  timer: ReturnType<typeof setTimeout> | null;
  /** Removes the channel from the idle list when it closes, ends or receives unsolicited bytes. */
  onIdleGone: (() => void) | null;
}

interface Lease {
  channel: PooledChannel;
  /** The channel already served a request: a failure before any byte may be the server's idle close. */
  reused: boolean;
}

interface Waiter {
  resolve: (lease: Promise<Lease>) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** A keep-alive pool of channels to one machine (PAN-4834 FR-2, FR-3). */
export function createChannelPool(options: ChannelPoolOptions): ChannelPool {
  const { dial } = options;
  const max = options.max ?? CHANNEL_POOL_MAX;
  const idleMs = options.idleMs ?? CHANNEL_POOL_IDLE_MS;
  /** Most recently idled last. */
  const idle: PooledChannel[] = [];
  const leased = new Set<PooledChannel>();
  const queue: Waiter[] = [];
  /** Slots held by leases and dials in flight. */
  let busy = 0;
  let closed = false;

  const poolClosed = (): ChannelHttpError => new ChannelHttpError('pool-closed', 'The channel pool is closed', false);
  // A stream that errors while nobody listens must not crash the page; the failure surfaces through close.
  const swallowError = (): void => {};

  function destroyChannel(channel: PooledChannel): void {
    unpark(channel);
    channel.stream.off('error', swallowError);
    channel.stream.destroy();
  }

  function unpark(channel: PooledChannel): void {
    if (channel.timer !== null) clearTimeout(channel.timer);
    channel.timer = null;
    if (channel.onIdleGone) {
      channel.stream.off('close', channel.onIdleGone);
      channel.stream.off('end', channel.onIdleGone);
      channel.stream.off('data', channel.onIdleGone);
      channel.onIdleGone = null;
    }
    const index = idle.indexOf(channel);
    if (index >= 0) idle.splice(index, 1);
  }

  function park(channel: PooledChannel, keepAliveTimeoutMs: number | null): void {
    const hinted = keepAliveTimeoutMs === null ? null : keepAliveTimeoutMs - 1000;
    const ms = hinted !== null && hinted > 0 && hinted < idleMs ? hinted : idleMs;
    const onIdleGone = (): void => {
      destroyChannel(channel);
      pump();
    };
    channel.onIdleGone = onIdleGone;
    channel.stream.on('close', onIdleGone);
    channel.stream.on('end', onIdleGone);
    channel.stream.on('data', onIdleGone);
    channel.timer = setTimeout(() => {
      channel.timer = null;
      channel.stream.end();
      destroyChannel(channel);
      pump();
    }, ms);
    idle.push(channel);
  }

  async function dialLease(): Promise<Lease> {
    let stream: ChannelStream;
    try {
      stream = await dial();
    } catch (error) {
      busy--;
      pump();
      const message = error instanceof Error ? error.message : String(error);
      throw new ChannelHttpError('dial-failed', `Could not open a channel: ${message}`, false, { cause: error });
    }
    const channel: PooledChannel = { stream, timer: null, onIdleGone: null };
    stream.on('error', swallowError);
    if (closed) {
      busy--;
      destroyChannel(channel);
      throw poolClosed();
    }
    leased.add(channel);
    return { channel, reused: false };
  }

  /** A lease when there is capacity, else null. Takes a slot synchronously. */
  function tryAcquire(): Promise<Lease> | null {
    const channel = idle.at(-1);
    if (channel) {
      unpark(channel);
      busy++;
      leased.add(channel);
      return Promise.resolve({ channel, reused: true });
    }
    if (idle.length + busy < max) {
      busy++;
      return dialLease();
    }
    return null;
  }

  function acquire(signal?: AbortSignal): Promise<Lease> {
    const now = tryAcquire();
    if (now) return now;
    return new Promise<Lease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index >= 0) queue.splice(index, 1);
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      queue.push(waiter);
    });
  }

  /** Hands freed capacity to queued requests in FIFO order. */
  function pump(): void {
    while (queue.length > 0 && !closed) {
      const lease = tryAcquire();
      if (!lease) return;
      const waiter = queue.shift()!;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.resolve(lease);
    }
  }

  function finish(channel: PooledChannel, result: ChannelRequestResult | null): void {
    leased.delete(channel);
    busy--;
    if (result?.reusable && !closed && !channel.stream.destroyed) park(channel, result.keepAliveTimeoutMs);
    else destroyChannel(channel);
    pump();
  }

  async function request(req: HttpRequest, opts: ChannelRequestOptions = {}): Promise<HttpResponse> {
    const { signal } = opts;
    if (closed) throw poolClosed();
    if (signal?.aborted) throw abortReason(signal);
    let lease = await acquire(signal);
    let resent = false;
    for (;;) {
      try {
        const result = await requestOnChannel(lease.channel.stream, req, { signal });
        finish(lease.channel, result);
        return result.response;
      } catch (error) {
        if (closed) {
          finish(lease.channel, null);
          throw poolClosed();
        }
        const stale =
          !resent &&
          lease.reused &&
          error instanceof ChannelHttpError &&
          error.code === 'channel-closed' &&
          !error.responded &&
          RETRY_SAFE_METHODS.has(req.method.toUpperCase());
        if (!stale) {
          finish(lease.channel, null);
          throw error;
        }
        // The idle channels idled and died together; resend on a fresh channel in the same slot.
        leased.delete(lease.channel);
        destroyChannel(lease.channel);
        for (const channel of [...idle]) destroyChannel(channel);
        resent = true;
        lease = await dialLease();
      }
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    for (const channel of [...idle]) destroyChannel(channel);
    for (const channel of [...leased]) destroyChannel(channel);
    for (const waiter of queue.splice(0)) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.reject(poolClosed());
    }
  }

  return {
    request,
    close,
    get size() {
      return idle.length + busy;
    },
    get idleCount() {
      return idle.length;
    },
  };
}
