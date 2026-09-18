/**
 * Herdr socket API client (PAN-3917 FR-4, W8).
 *
 * Herdr's private API is NDJSON over a unix socket, one request per
 * connection: the client connects, writes a single `{id, method, params}`
 * line, reads a single `{id, result}` or `{id, error}` line, and the server
 * closes the connection. Verified live against herdr v0.9.1 (protocol 22) on
 * 2026-09-18 — pipelining a second request onto the same connection is
 * answered with a reset, so `call` opens its own connection every time.
 *
 * `events.subscribe` is the exception: the server answers
 * `{"id":"…","result":{"type":"subscription_started"}}` and then streams
 * `{"event":"<kind>","data":{…}}` frames on that same connection until the
 * client closes it. `stream()` serves that shape.
 *
 * Two safety rules live here:
 *
 *  - **No retry of a mutating call after an ambiguous disconnect.** When the
 *    socket dies after the request was written but before a response line
 *    arrived, the server may or may not have applied the mutation. The error
 *    carries `ambiguous: true`; callers must inspect live state instead of
 *    re-sending (the same rule the Herdr CLI guide states for machine
 *    forwarding).
 *  - **Bounded frames.** A response line longer than `maxFrameBytes` aborts
 *    the request rather than growing the buffer without limit.
 */

import { createConnection } from 'net';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Data } from 'effect';

import { herdrSocketPath } from './select.js';

/** Protocol generation and schema version this adapter was written against. */
export const HERDR_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '__fixtures__',
  'herdr-v0.9.1',
);

/** Default cap on a single NDJSON response line (a session snapshot is the big one). */
export const DEFAULT_MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Default per-request deadline. Long waits (`agent.wait`) pass their own. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Methods that change server state. A disconnect with no response after one of
 * these was written is ambiguous and is never retried.
 */
const MUTATING_METHODS: ReadonlySet<string> = new Set([
  'workspace.create',
  'workspace.close',
  'workspace.rename',
  'workspace.report_metadata',
  'tab.create',
  'tab.close',
  'pane.split',
  'pane.close',
  'pane.move',
  'pane.rename',
  'pane.resize',
  'pane.send_text',
  'pane.send_keys',
  'pane.send_input',
  'pane.report_agent',
  'pane.report_agent_session',
  'pane.report_metadata',
  'pane.release_agent',
  'agent.start',
  'agent.prompt',
  'agent.rename',
  'agent.send_keys',
  'worktree.create',
  'worktree.remove',
  'server.stop',
]);

export function isMutatingHerdrMethod(method: string): boolean {
  return MUTATING_METHODS.has(method);
}

/** A Herdr API call failed. `ambiguous` marks a mutation of unknown outcome. */
export class HerdrApiError extends Data.TaggedError('HerdrApiError')<{
  readonly method: string;
  readonly code: string;
  readonly message: string;
  /** True when a mutating request was written but no response was read. */
  readonly ambiguous?: boolean;
  readonly cause?: unknown;
}> {}

/** The duplex the client talks to. `net.Socket` in production, a fake in tests. */
export interface HerdrSocket {
  write(data: string): unknown;
  end(): unknown;
  destroy(error?: Error): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'connect', listener: () => void): unknown;
}

export interface HerdrApiOptions {
  /** Session socket. Defaults to the `overdeck` session socket. */
  readonly socketPath?: string;
  /** Connection factory; injected in tests so no unit test touches a real socket. */
  readonly connect?: (socketPath: string) => HerdrSocket;
  readonly requestTimeoutMs?: number;
  readonly maxFrameBytes?: number;
}

export interface HerdrCallOptions {
  readonly timeoutMs?: number;
}

/** A live NDJSON stream (`events.subscribe`). */
export interface HerdrStream {
  /** Resolves once the server answered `subscription_started`. */
  readonly started: Promise<void>;
  close(): void;
}

export interface HerdrStreamHandlers {
  onEvent(event: string, data: Record<string, unknown>): void;
  onError?(error: HerdrApiError): void;
  onClose?(): void;
}

interface HerdrResponse {
  readonly id?: string;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: string; readonly message?: string };
}

/** Line framer shared by `call` and `stream`. */
class LineReader {
  private buffer = '';

  constructor(private readonly maxBytes: number) {}

  /** Push a chunk; returns the complete lines it produced. Throws when unbounded. */
  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const lines: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      lines.push(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxBytes) {
      throw new Error(`herdr response frame exceeded ${this.maxBytes} bytes without a newline`);
    }
    return lines;
  }
}

let requestCounter = 0;

function nextRequestId(): string {
  requestCounter += 1;
  return `od-${requestCounter}`;
}

export class HerdrApiClient {
  readonly socketPath: string;
  private readonly connect: (socketPath: string) => HerdrSocket;
  private readonly requestTimeoutMs: number;
  private readonly maxFrameBytes: number;

  constructor(options: HerdrApiOptions = {}) {
    this.socketPath = options.socketPath ?? herdrSocketPath();
    this.connect = options.connect ?? ((path) => createConnection(path) as unknown as HerdrSocket);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  /**
   * One request, one response. The correlation id is echoed by the server; a
   * request the server could not even parse comes back with an empty id, and
   * that is still the answer to the single in-flight request.
   */
  async call<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
    options: HerdrCallOptions = {},
  ): Promise<T> {
    const id = nextRequestId();
    const reader = new LineReader(this.maxFrameBytes);
    const socket = this.connect(this.socketPath);
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;

    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      let written = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          socket.destroy();
        } catch {
          /* already gone */
        }
        outcome();
      };

      const fail = (code: string, message: string, ambiguous = false, cause?: unknown): void => {
        finish(() => reject(new HerdrApiError({ method, code, message, ambiguous, cause })));
      };

      timer = setTimeout(() => {
        fail(
          'timeout',
          `herdr ${method} did not answer within ${timeoutMs}ms`,
          written && isMutatingHerdrMethod(method),
        );
      }, timeoutMs);
      timer.unref?.();

      socket.on('connect', () => {
        try {
          socket.write(`${JSON.stringify({ id, method, params })}\n`);
          written = true;
        } catch (cause) {
          fail('write_failed', `herdr ${method} could not be written`, false, cause);
        }
      });

      socket.on('data', (chunk) => {
        let lines: string[];
        try {
          lines = reader.push(chunk);
        } catch (cause) {
          fail('frame_too_large', cause instanceof Error ? cause.message : String(cause), false, cause);
          return;
        }
        for (const line of lines) {
          if (!line.trim()) continue;
          let response: HerdrResponse;
          try {
            response = JSON.parse(line) as HerdrResponse;
          } catch (cause) {
            fail('invalid_json', `herdr ${method} returned a line that is not JSON`, false, cause);
            return;
          }
          // A parse-level rejection carries an empty id; it is still the answer
          // to the one request this connection ever sends.
          if (response.id && response.id !== id && response.id !== '') continue;
          if (response.error) {
            fail(response.error.code ?? 'error', response.error.message ?? `herdr ${method} failed`);
            return;
          }
          finish(() => resolve((response.result ?? {}) as T));
          return;
        }
      });

      socket.on('error', (error) => {
        fail(
          'socket_error',
          `herdr ${method}: ${error.message}`,
          written && isMutatingHerdrMethod(method),
          error,
        );
      });

      socket.on('close', () => {
        // Closed with no response line: the mutation's outcome is unknown.
        fail(
          'disconnected',
          `herdr ${method}: the server closed the connection before answering`,
          written && isMutatingHerdrMethod(method),
        );
      });
    });
  }

  /**
   * Open a long-lived subscription. The first line is the
   * `subscription_started` acknowledgement; every later line is an event.
   */
  stream(
    method: string,
    params: Record<string, unknown>,
    handlers: HerdrStreamHandlers,
  ): HerdrStream {
    const id = nextRequestId();
    const reader = new LineReader(this.maxFrameBytes);
    const socket = this.connect(this.socketPath);
    let acknowledged = false;
    let closed = false;
    let resolveStarted: () => void = () => {};
    let rejectStarted: (error: HerdrApiError) => void = () => {};
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    // A caller that only closes the stream must not trip an unhandled rejection.
    started.catch(() => {});

    const close = (): void => {
      if (closed) return;
      closed = true;
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      handlers.onClose?.();
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });

    socket.on('data', (chunk) => {
      let lines: string[];
      try {
        lines = reader.push(chunk);
      } catch (cause) {
        const error = new HerdrApiError({
          method,
          code: 'frame_too_large',
          message: cause instanceof Error ? cause.message : String(cause),
        });
        if (!acknowledged) rejectStarted(error);
        handlers.onError?.(error);
        close();
        return;
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame: HerdrResponse & { event?: string; data?: Record<string, unknown> };
        try {
          frame = JSON.parse(line);
        } catch {
          continue; // A malformed event line must not kill a live subscription.
        }
        if (frame.error) {
          const error = new HerdrApiError({
            method,
            code: frame.error.code ?? 'error',
            message: frame.error.message ?? `herdr ${method} failed`,
          });
          if (!acknowledged) rejectStarted(error);
          handlers.onError?.(error);
          close();
          return;
        }
        if (!acknowledged && frame.result) {
          acknowledged = true;
          resolveStarted();
          continue;
        }
        if (frame.event) handlers.onEvent(frame.event, frame.data ?? {});
      }
    });

    socket.on('error', (error) => {
      const wrapped = new HerdrApiError({ method, code: 'socket_error', message: error.message, cause: error });
      if (!acknowledged) rejectStarted(wrapped);
      handlers.onError?.(wrapped);
      close();
    });

    socket.on('close', () => {
      if (!acknowledged) {
        rejectStarted(new HerdrApiError({
          method,
          code: 'disconnected',
          message: `herdr ${method}: the server closed the subscription before acknowledging it`,
        }));
      }
      close();
    });

    return { started, close };
  }

  /**
   * Check the live server against the committed schema fixture (NFR-5): the
   * `ping` response carries the protocol generation and the version, and the
   * fixture carries the protocol and schema version this adapter was written
   * against. A mismatch is a typed error, never a silent downgrade — and never
   * a reason to stop or update a server.
   */
  async probe(options: { fixturePath?: string } = {}): Promise<HerdrProbe> {
    const fixturePath = options.fixturePath ?? join(HERDR_FIXTURE_DIR, 'schema.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf-8')) as {
      protocol?: number;
      schema_version?: number;
    };
    const pong = await this.call<{ version?: string; protocol?: number }>('ping', {});
    const serverProtocol = pong.protocol ?? -1;
    const expectedProtocol = fixture.protocol ?? -1;
    if (serverProtocol !== expectedProtocol) {
      throw new HerdrApiError({
        method: 'ping',
        code: 'protocol_mismatch',
        message:
          `herdr server speaks protocol ${serverProtocol}; this adapter was written against protocol ` +
          `${expectedProtocol} (schema fixture ${fixturePath}).`,
      });
    }
    return {
      version: pong.version ?? 'unknown',
      protocol: serverProtocol,
      schemaVersion: fixture.schema_version ?? -1,
    };
  }
}

export interface HerdrProbe {
  readonly version: string;
  readonly protocol: number;
  readonly schemaVersion: number;
}

let sharedClient: HerdrApiClient | null = null;

/** The process-wide client for the `overdeck` session. */
export function getHerdrApiClient(): HerdrApiClient {
  sharedClient ??= new HerdrApiClient();
  return sharedClient;
}

/** Tests and the dashboard swap the client; passing null restores the default. */
export function setHerdrApiClient(client: HerdrApiClient | null): void {
  sharedClient = client;
}
