/**
 * Secure-channel listener on the dashboard port (PAN-4645 WI-3, D-4645-4).
 *
 * Raw TCP: a `connection` dispatcher installed in the `NodeHttpServer.make`
 * factory reads the first byte of every new socket. `0x00` (the preamble's
 * first byte) means a secure channel: the socket goes to `acceptChannel` and,
 * once the Noise handshake proves the peer, the resulting `ChannelSocket` is
 * handed to Node's original HTTP `connection` listeners exactly like a TCP
 * socket. Anything else is HTTP: the byte is unshifted and the socket goes to
 * those same listeners untouched.
 *
 * WebSocket: an unauthenticated `/ws/link` upgrade (for HTTPS routes such as
 * Tailscale Serve, where TLS hides the upgrade) feeds a `ws` stream into the
 * same accept path. The Noise handshake, not a credential, authenticates it.
 *
 * Bounds (NFR-6): at most {@link DEFAULT_MAX_PENDING} handshakes in flight
 * (refusal `04` beyond that), the 10 s handshake timeout inside `acceptChannel`,
 * and a 10 s wait for the first byte of a silent socket.
 *
 * Sockets taken by the dispatcher are not tracked by `net.Server`, so
 * `server.close()` does not close them; `closeAllChannels` runs on the server's
 * `close` event. Installed only on primary dashboards (NFR-7).
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { PREAMBLE_MAGIC, REFUSAL_CODES } from '@overdeck/anywhere-channel';
import { createWebSocketStream, WebSocketServer } from 'ws';

import { acceptChannel, type PairingSecret, refuseChannel } from '../../lib/anywhere/channel/accept.js';
import type { ChannelSocket } from '../../lib/anywhere/channel/channel-socket.js';
import { anywhereDebug } from '../../lib/anywhere/debug-log.js';
import type { MachineKeyPair } from '../../lib/anywhere/machine-key.js';

export const DEFAULT_MAX_PENDING = 32;
/** A socket that sends nothing at all is dropped after this long. */
export const FIRST_BYTE_TIMEOUT_MS = 10_000;
export const LINK_UPGRADE_PATH = '/ws/link';

export interface ChannelListenerDeps {
  /** Only a primary dashboard accepts channels (NFR-7); peers install nothing. */
  primary: boolean;
  /** This machine's key pair; resolved once on the first channel. */
  localKey: () => Promise<MachineKeyPair>;
  /** IK: does an active `machine` token pin this initiator key? */
  isPinnedPeer: (remoteKeyHex: string) => boolean;
  /** XXpsk0: the PSK behind a pairing id, or `'unknown'`. */
  takePairing: (pairingId: string) => PairingSecret | 'unknown';
  /** Counts toward the pairing rate limiter. */
  onPairingFailure: () => void;
  /** Reported inside refusal `02`. */
  serverVersion?: () => Promise<string>;
  /** Approval mode (PAN-2356): accept one channel for this machine's own live request id. */
  takeApproval?: (requestId: string) => boolean;
  /** Approval mode: the accepted channel, so the requester can show its SAS. */
  onApprovalChannel?: (channel: ChannelSocket) => void;
  maxPending?: number;
  log?: (message: string) => void;
  /** `closed` and `timeout` refusals, which aborted probe channels cause routinely (PAN-5018 D-3). Default {@link anywhereDebug}. */
  debug?: (message: string) => void;
}

type ConnectionListener = (this: HttpServer, socket: Socket) => void;

const liveChannels = new Map<string, Set<ChannelSocket>>();
let pending = 0;

export function liveChannelCount(): number {
  let count = 0;
  for (const set of liveChannels.values()) count += set.size;
  return count;
}

export function pendingHandshakeCount(): number {
  return pending;
}

/** Destroy every live channel from one peer key. Returns how many were closed. */
export function closeChannelsForPeer(remoteKeyHex: string): number {
  const set = liveChannels.get(remoteKeyHex);
  if (!set) return 0;
  liveChannels.delete(remoteKeyHex);
  for (const channel of set) channel.destroy();
  return set.size;
}

export function closeAllChannels(): number {
  let closed = 0;
  for (const key of [...liveChannels.keys()]) closed += closeChannelsForPeer(key);
  return closed;
}

/** The installed listener's `accept`, kept so WebRTC data channels (PAN-2356 WI-11) reach it too. */
let acceptRaw: ((raw: Duplex) => Promise<void>) | null = null;

/**
 * Run the responder handshake on a raw transport that arrived some other way (a `direct` or
 * `relay` WebRTC data channel) and hand the channel to HTTP. Without an installed listener (a peer
 * dashboard), the transport is destroyed.
 */
export function acceptRawChannel(raw: Duplex): Promise<void> {
  if (!acceptRaw) {
    raw.destroy();
    return Promise.resolve();
  }
  return acceptRaw(raw);
}

export function _resetChannelListenerForTests(): void {
  closeAllChannels();
  pending = 0;
  acceptRaw = null;
}

export function installChannelListener(nodeServer: HttpServer, deps: ChannelListenerDeps): void {
  if (!deps.primary) return;
  const log = deps.log ?? ((message: string) => console.warn(`[anywhere] ${message}`));
  const debug = deps.debug ?? ((message: string) => anywhereDebug(message));
  const maxPending = deps.maxPending ?? DEFAULT_MAX_PENDING;

  let serverVersion = '';
  void deps.serverVersion?.().then((version) => { serverVersion = version; }, () => undefined);
  let keyPromise: Promise<MachineKeyPair> | null = null;
  const localKey = (): Promise<MachineKeyPair> => {
    keyPromise ??= deps.localKey().catch((error: unknown) => {
      keyPromise = null;
      throw error;
    });
    return keyPromise;
  };

  const httpListeners = nodeServer.listeners('connection') as ConnectionListener[];
  nodeServer.removeAllListeners('connection');
  const toHttp = (socket: Socket | ChannelSocket): void => {
    for (const listener of httpListeners) listener.call(nodeServer, socket as Socket);
  };

  /** Run the handshake on a raw duplex (TCP or `/ws/link`) and hand the channel to HTTP. */
  const accept = async (raw: Duplex, resume: () => void): Promise<void> => {
    if (pending >= maxPending) {
      refuseChannel(raw, { code: REFUSAL_CODES.busy });
      resume();
      return;
    }
    pending += 1;
    try {
      const key = await localKey();
      const channelPromise = acceptChannel(raw, {
        localKey: key,
        isPinnedPeer: deps.isPinnedPeer,
        takePairing: deps.takePairing,
        onPairingFailure: deps.onPairingFailure,
        takeApproval: deps.takeApproval,
        serverVersion,
      });
      resume();
      const channel = await channelPromise;
      track(channel);
      if (channel.channel.mode === 'approval') deps.onApprovalChannel?.(channel);
      toHttp(channel);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'error';
      const mode = (error as { mode?: string | null }).mode ?? 'unknown';
      const line = `channel refused (${code}, ${mode}): ${(error as Error).message}`;
      if (code === 'closed' || code === 'timeout') debug(line);
      else log(line);
      if (!raw.destroyed) raw.destroy();
    } finally {
      pending -= 1;
    }
  };

  acceptRaw = (raw) => {
    raw.pause();
    return accept(raw, () => raw.resume());
  };

  nodeServer.on('connection', (socket: Socket) => {
    const onPreDispatchError = (): void => undefined;
    socket.on('error', onPreDispatchError);
    socket.setTimeout(FIRST_BYTE_TIMEOUT_MS, () => socket.destroy());
    socket.once('data', (chunk: Buffer) => {
      socket.setTimeout(0);
      socket.off('error', onPreDispatchError);
      socket.pause();
      socket.unshift(chunk);
      if (chunk[0] === PREAMBLE_MAGIC[0]) {
        void accept(socket, () => socket.resume());
        return;
      }
      toHttp(socket);
      socket.resume();
    });
  });

  // `/ws/link`: register before Effect's upgrade handler and make that handler
  // skip our path, the same way the terminal and voice sockets do.
  const wss = new WebSocketServer({ noServer: true });
  const originalOn = nodeServer.on.bind(nodeServer);
  nodeServer.on = function (event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      const wrapped = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
        if (upgradePath(request) === LINK_UPGRADE_PATH) return;
        (listener as (req: IncomingMessage, socket: Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof nodeServer.on;
  originalOn('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (upgradePath(request) !== LINK_UPGRADE_PATH) return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      const raw = createWebSocketStream(ws);
      raw.pause();
      void accept(raw, () => raw.resume());
    });
  });

  nodeServer.once('close', () => {
    closeAllChannels();
    wss.close();
    acceptRaw = null;
  });
}

function upgradePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`).pathname;
  } catch {
    return '';
  }
}

function track(channel: ChannelSocket): void {
  const key = channel.channel.remoteKeyHex;
  let set = liveChannels.get(key);
  if (!set) {
    set = new Set();
    liveChannels.set(key, set);
  }
  set.add(channel);
  channel.once('close', () => {
    const current = liveChannels.get(key);
    if (!current) return;
    current.delete(channel);
    if (current.size === 0) liveChannels.delete(key);
  });
}
