/**
 * Initiator side of a secure channel (PAN-4645 WI-2, D-4645-5).
 *
 * `openChannel` connects a transport (`tcp://host:port` raw TCP to the
 * dashboard port, or `wss://host[:port]/ws/link` inside HTTPS), writes the
 * preamble, runs Noise IK (link: proves the pinned machine key before any
 * application byte) or XXpsk0 (pairing: keyed by the pairing code) and
 * resolves with a {@link ChannelSocket}. The transport-agnostic handshake
 * sequence lives in `@overdeck/anywhere-channel` (`runInitiatorHandshake`,
 * PAN-4833 D-6); this module keeps the Node transports.
 *
 * Timeouts use `AbortController` + `setTimeout`, never `AbortSignal.timeout`
 * (it ignores fake timers under happy-dom).
 */
import { connect as netConnect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { ChannelOpenError, type InitiatorFinish, type InitiatorOptions, runInitiatorHandshake, toOpenError, withDeadline } from '@overdeck/anywhere-channel';
import { nodeCrypto } from '@overdeck/anywhere-channel/node';
import { createWebSocketStream, WebSocket as WsClient } from 'ws';

import { type ChannelSocket, createChannelSocket } from './channel-socket.js';

export { ChannelOpenError, type ChannelOpenDetail, type ChannelOpenErrorCode, DEFAULT_OPEN_TIMEOUT_MS } from '@overdeck/anywhere-channel';

/** wss route query parameter naming one Fly machine; sent as `fly-force-instance-id` (PAN-4652 D-3). */
export const FLY_INSTANCE_PARAM = 'fly-instance';

export type TransportUrl = `tcp://${string}` | `wss://${string}` | `rtc://${string}` | `rtc+turn://${string}`;

/** Opens a WebRTC data channel to `rtc://<id>` or `rtc+turn://<id>` (PAN-2356 WI-11). */
export type RtcDialer = (url: `rtc://${string}` | `rtc+turn://${string}`, signal: AbortSignal) => Promise<Duplex>;

let rtcDialer: RtcDialer | null = null;

/** The dashboard registers the directory's WebRTC dialer here; null when signed out. */
export function setRtcDialer(dialer: RtcDialer | null): void {
  rtcDialer = dialer;
}

export type OpenChannelOptions = InitiatorOptions;

/** Builds the secure stream in the same tick as the last handshake frame. */
const toChannelSocket: InitiatorFinish<ChannelSocket, Duplex> = ({ raw, handshake, leftover, channel }) =>
  createChannelSocket({ raw, initiator: true, handshake, channel, leftover });

export async function openChannel(url: TransportUrl, opts: OpenChannelOptions): Promise<ChannelSocket> {
  return withDeadline<ChannelSocket, Duplex>(url, opts, async (signal, track) => {
    const raw = await connectTransport(url, signal);
    track(raw);
    return runInitiatorHandshake(raw, url, opts, nodeCrypto, track, toChannelSocket);
  });
}

/**
 * Run the initiator handshake over a transport that is already connected
 * (for example a `/ws/link` WebSocket stream the caller opened itself).
 * The same timeout and abort rules as {@link openChannel} apply.
 */
export async function openChannelOverTransport(raw: Duplex, opts: OpenChannelOptions, label = 'transport'): Promise<ChannelSocket> {
  return withDeadline<ChannelSocket, Duplex>(label, opts, async (_signal, track) => {
    track(raw);
    return runInitiatorHandshake(raw, label, opts, nodeCrypto, track, toChannelSocket);
  });
}

type TransportTarget =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'wss'; url: string; headers?: Record<string, string> };

function parseTransportUrl(url: TransportUrl): TransportTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ChannelOpenError('protocol', `Not a transport URL: ${url}`);
  }
  if (parsed.protocol === 'tcp:') {
    const port = Number(parsed.port);
    if (!parsed.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new ChannelOpenError('protocol', `tcp:// transport needs host and port: ${url}`);
    }
    return { kind: 'tcp', host: parsed.hostname.replace(/^\[|\]$/g, ''), port };
  }
  if (parsed.protocol === 'wss:') {
    // Many Fly machines share `<app>.fly.dev`; the Fly proxy pins one by this header.
    const instance = parsed.searchParams.get(FLY_INSTANCE_PARAM);
    if (!instance) return { kind: 'wss', url };
    parsed.searchParams.delete(FLY_INSTANCE_PARAM);
    return { kind: 'wss', url: parsed.toString(), headers: { 'fly-force-instance-id': instance } };
  }
  throw new ChannelOpenError('protocol', `Unsupported transport scheme in ${url}`);
}

function connectTransport(url: TransportUrl, signal: AbortSignal): Promise<Duplex> {
  if (url.startsWith('rtc://') || url.startsWith('rtc+turn://')) {
    const rtcUrl = url as `rtc://${string}` | `rtc+turn://${string}`;
    if (!rtcDialer) {
      return Promise.reject(new ChannelOpenError('unreachable', 'Direct connections need an overdeck.ai sign-in'));
    }
    if (signal.aborted) return Promise.reject(toOpenError(signal.reason, url));
    return rtcDialer(rtcUrl, signal).catch((error: unknown) => {
      throw toOpenError(signal.aborted ? signal.reason : error, url);
    });
  }
  const target = parseTransportUrl(url);
  return new Promise<Duplex>((resolve, reject) => {
    const fail = (error: unknown): void => reject(toOpenError(error, url));
    if (signal.aborted) {
      fail(signal.reason);
      return;
    }
    if (target.kind === 'tcp') {
      const socket: Socket = netConnect({ host: target.host, port: target.port });
      const onAbort = (): void => {
        socket.destroy();
        fail(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      socket.once('error', (error) => {
        signal.removeEventListener('abort', onAbort);
        const opened = toOpenError(error, url);
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === 'string' && opened.code === 'unreachable') {
          reject(new ChannelOpenError('unreachable', opened.message, { ...opened.detail, cause: code }));
          return;
        }
        reject(opened);
      });
      socket.once('connect', () => {
        signal.removeEventListener('abort', onAbort);
        socket.setNoDelay(true);
        resolve(socket);
      });
      return;
    }
    const ws = new WsClient(target.url, target.headers ? { headers: target.headers } : undefined);
    const onAbort = (): void => {
      ws.terminate();
      fail(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    ws.once('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      fail(error);
    });
    ws.once('open', () => {
      signal.removeEventListener('abort', onAbort);
      resolve(createWebSocketStream(ws));
    });
  });
}
