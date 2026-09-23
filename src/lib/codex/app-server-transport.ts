/**
 * Codex app-server wire transports (PAN-3835).
 *
 * The manager speaks JSON-RPC to `codex app-server` over one of two framings:
 *
 * - stdio: newline-delimited JSON on the child's stdin/stdout. The default for
 *   every host, and the only transport work and review agents use.
 * - native Unix socket: `codex app-server --listen unix://<path>` accepts
 *   WebSocket connections (HTTP Upgrade, one JSON message per text frame) on a
 *   private socket. A conversation host connects here so the native Codex TUI
 *   can attach to the same app-server as a second client with
 *   `codex resume --remote unix://<path> <threadId>`.
 *
 * Verified against codex-cli 0.153.4 (docs/CODEX-APP-SERVER-PROTOCOL.md,
 * "Native terminal attachment"): the server rejects the handshake when the
 * client offers permessage-deflate, so the WebSocket client disables it.
 */
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { WebSocket } from 'ws';

/** One framed JSON-RPC channel to an app-server. */
export interface AppServerTransport {
  /** Send one JSON message. Throws when the channel is closed. */
  send(message: unknown): void;
  /** Register the handler for every received text message. */
  onMessage(handler: (text: string) => void): void;
  /** Register the handler for the channel closing, for any reason. */
  onClose(handler: (reason: string) => void): void;
  close(): void;
}

/** Newline-delimited JSON over a child's stdio pipes. */
export function createStdioTransport(stdout: Readable, stdin: Writable): AppServerTransport {
  const lines = createInterface({ input: stdout, crlfDelay: Infinity });
  let open = true;
  let closeHandler: ((reason: string) => void) | undefined;
  lines.on('close', () => {
    if (!open) return;
    open = false;
    closeHandler?.('stdout closed');
  });
  return {
    send(message) {
      if (!open || !stdin.writable) throw new Error('Cannot write to codex app-server stdin.');
      stdin.write(`${JSON.stringify(message)}\n`);
    },
    onMessage(handler) {
      lines.on('line', handler);
    },
    onClose(handler) {
      closeHandler = handler;
    },
    close() {
      open = false;
      lines.close();
    },
  };
}

/** Maximum socket path length Overdeck will hand to `--listen unix://`. */
export const NATIVE_SOCKET_PATH_MAX_BYTES = 100;

export function nativeEndpointUrl(socketPath: string): string {
  return `unix://${socketPath}`;
}

export interface UnixWebSocketConnectOptions {
  /** Give up after this long without a successful handshake. */
  readonly timeoutMs?: number;
  /** Delay between attempts while the server has not created the socket yet. */
  readonly retryDelayMs?: number;
  /** Test seam: open one WebSocket. */
  readonly createSocket?: (url: string) => WebSocket;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 100;

function openOnce(socket: WebSocket): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      socket.off('error', onError);
      resolve(socket);
    };
    const onError = (error: Error) => {
      socket.off('open', onOpen);
      reject(error);
    };
    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

/**
 * Connect to `codex app-server --listen unix://<socketPath>`, retrying while
 * the freshly spawned server has not bound its socket yet. Bounded: rejects
 * with the last connection error once `timeoutMs` passes.
 */
export async function connectUnixWebSocketTransport(
  socketPath: string,
  options: UnixWebSocketConnectOptions = {},
): Promise<AppServerTransport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const createSocket = options.createSocket
    ?? ((url: string) => new WebSocket(url, { perMessageDeflate: false }));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const url = `ws+unix://${socketPath}:/`;
  const deadline = now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    const socket = createSocket(url);
    try {
      return wrapWebSocket(await openOnce(socket));
    } catch (error) {
      lastError = error;
      socket.terminate();
    }
    if (now() + retryDelayMs > deadline) break;
    await sleep(retryDelayMs);
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not connect to codex app-server at ${nativeEndpointUrl(socketPath)} within ${timeoutMs}ms: ${detail}`);
}

function wrapWebSocket(socket: WebSocket): AppServerTransport {
  let closeHandler: ((reason: string) => void) | undefined;
  let closed = false;
  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    closeHandler?.(reason);
  };
  // Frames that arrive before the manager registers its handler are queued.
  let messageHandler: ((text: string) => void) | undefined;
  const queued: string[] = [];
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const text = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
    if (messageHandler) messageHandler(text);
    else queued.push(text);
  });
  socket.on('close', (code) => finish(`websocket closed (${code})`));
  socket.on('error', (error) => finish(`websocket error: ${error.message}`));
  return {
    send(message) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        throw new Error('Cannot write to codex app-server: native socket is closed.');
      }
      socket.send(JSON.stringify(message));
    },
    onMessage(handler) {
      messageHandler = handler;
      for (const text of queued.splice(0)) handler(text);
    },
    onClose(handler) {
      closeHandler = handler;
    },
    close() {
      closed = true;
      socket.close();
    },
  };
}
