/**
 * The owner's half of a port forward (PAN-4650 WI-17, D-4650-16, pan-2350 D-22).
 *
 * `/ws/forward?port=<n>` lets a linked machine reach a dev server on this
 * machine for **Open preview**. Only a caller on a secure channel with a
 * `machine` credential that holds the `forward` scope and acts as the
 * operator may open one; an agent actor is refused `agent-fenced`. Overdeck's
 * own ports and ports outside 1024-65535 are refused with 403
 * `port-refused` before the upgrade. An accepted forward connects to
 * `127.0.0.1:<port>` only and pipes the WebSocket stream to that socket;
 * either side ending closes both.
 */
import type { IncomingMessage, Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { createWebSocketStream, type WebSocket, WebSocketServer } from 'ws';

import type { ChannelMarker } from './channel-peer.js';
import { isForwardablePort, refusedForwardPorts } from './forward-ports.js';
import { AGENT_FENCED, AGENT_FENCED_MESSAGE, linkActorFence } from './link-fence.js';
import { authorizeDashboardUpgrade, channelOfIncoming, rejectUpgrade, trackDeviceSocket, type UpgradeAuthResult } from './ws-auth.js';

export const FORWARD_PATH = '/ws/forward';

export interface ForwardWebSocketDeps {
  channelOf: (request: IncomingMessage) => ChannelMarker | null;
  authorize: (request: IncomingMessage, channel: ChannelMarker) => UpgradeAuthResult;
  refusedPorts: () => Promise<ReadonlySet<number>>;
  connectTcp: (port: number) => Socket;
}

const defaultDeps: ForwardWebSocketDeps = {
  channelOf: channelOfIncoming,
  authorize: (request, channel) => authorizeDashboardUpgrade(request.headers, request.method ?? 'GET', 'forward', channel),
  refusedPorts: refusedForwardPorts,
  connectTcp: (port) => connect({ host: '127.0.0.1', port }),
};

/** Answer an upgrade with a JSON error body, so the viewer can read the code. */
export function rejectUpgradeJson(socket: Duplex, status: number, body: { error: string; code?: string }): void {
  const text = JSON.stringify(body);
  // end(), not write() + destroy(): over a secure channel destroy() drops the queued response.
  socket.end(
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Error'}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
  );
}

function pipeToPort(ws: WebSocket, tcp: Socket): void {
  const stream = createWebSocketStream(ws);
  const closeBoth = () => {
    stream.destroy();
    tcp.destroy();
  };
  stream.on('error', closeBoth);
  tcp.on('error', closeBoth);
  stream.on('close', closeBoth);
  tcp.on('close', closeBoth);
  stream.pipe(tcp);
  tcp.pipe(stream);
}

async function handleForwardUpgrade(request: IncomingMessage, socket: Socket, head: Buffer, wss: WebSocketServer, deps: ForwardWebSocketDeps): Promise<void> {
  const channel = deps.channelOf(request);
  if (!channel) return rejectUpgrade(socket, 403, 'Forbidden: forwards are for linked machines only');
  const auth = deps.authorize(request, channel);
  if (!auth.ok) return rejectUpgrade(socket, auth.status, auth.message);
  if (linkActorFence(auth.credential, 'GET', FORWARD_PATH)) {
    return rejectUpgradeJson(socket, 403, { error: AGENT_FENCED_MESSAGE, code: AGENT_FENCED });
  }
  const port = Number(new URL(request.url ?? '', 'http://localhost').searchParams.get('port'));
  if (!isForwardablePort(port, await deps.refusedPorts())) {
    return rejectUpgradeJson(socket, 403, { error: `Port ${port} cannot be forwarded: it is an Overdeck port or outside 1024-65535`, code: 'port-refused' });
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    trackDeviceSocket(auth.credential, ws);
    pipeToPort(ws, deps.connectTcp(port));
  });
}

/** Handle `/ws/forward` upgrades on `server`; every other upgrade listener skips them. */
export function setupForwardWebSocket(server: Server, overrides: Partial<ForwardWebSocketDeps> = {}): void {
  const deps = { ...defaultDeps, ...overrides };
  const wss = new WebSocketServer({ noServer: true });
  const isForward = (request: IncomingMessage) => new URL(request.url ?? '', 'http://localhost').pathname === FORWARD_PATH;
  const originalOn = server.on.bind(server);
  server.on = function (event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      const wrapped = (request: IncomingMessage, socket: Socket, head: Buffer) => {
        if (isForward(request)) return;
        (listener as (req: IncomingMessage, socket: Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!isForward(request)) return;
    handleForwardUpgrade(request, socket, head, wss, deps).catch((error: unknown) => {
      if (!socket.destroyed) rejectUpgrade(socket, 500, `Internal Server Error: ${(error as Error).message}`);
    });
  });
}
