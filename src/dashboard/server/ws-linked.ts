/**
 * WebSocket remote control of a linked conversation (PAN-4650 WI-7, D-4650-5).
 *
 * The viewing server answers upgrades on `/ws/linked/<environmentId>/rpc` and
 * `/ws/linked/<environmentId>/terminal` itself. It authorizes the browser
 * locally (`admin`), refuses callers that arrive over a channel (no chained
 * hops), opens a secure channel to the link, and writes the owner's upgrade
 * request for `/ws/rpc` or `/ws/terminal?<query>` with the link token, the
 * `operator` actor stamp and no `Origin`. When the owner answers 101 the
 * response head goes back to the browser and bytes are piped both ways; the
 * WebSocket handshake key passes through, so the browser validates the
 * owner's accept header end to end. Either side ending closes both. A failed
 * upgrade answers with the cause's status: 401/403 local auth, 503 link
 * unavailable, or the owner's own non-101 status.
 *
 * The owner's restricted RPC group (PAN-4645 D-4645-14) and terminal scope
 * decide what the link may do; this module adds no permissions.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { LINK_ACTOR_HEADER } from '../../lib/anywhere/link-actor.js';
import { LinkUnavailableError, openLinkSocket } from '../../lib/anywhere/link-client.js';
import { getLink, type MachineLink } from '../../lib/anywhere/link-store.js';
import type { ChannelMarker } from './channel-peer.js';
import { authorizeDashboardUpgrade, channelOfIncoming, rejectUpgrade, type UpgradeAuthResult } from './ws-auth.js';

const LINKED_PATH = /^\/ws\/linked\/([^/]+)\/(rpc|terminal)$/;
/** Longest wait for the owner's upgrade answer. */
export const LINKED_UPGRADE_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_HEAD_BYTES = 16 * 1024;
/** Browser handshake headers the owner needs to answer the same handshake. */
const PASSED_HEADERS = ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions'];

export interface LinkedWebSocketDeps {
  openLinkSocket: (environmentId: string) => Promise<Duplex>;
  getLink: (idOrEnvOrLabel: string) => Promise<MachineLink | null>;
  authorize: (request: IncomingMessage, channel: ChannelMarker | null) => UpgradeAuthResult;
  channelOf: (request: IncomingMessage) => ChannelMarker | null;
  timeoutMs: number;
}

const defaultDeps: LinkedWebSocketDeps = {
  openLinkSocket: (environmentId) => openLinkSocket(environmentId),
  getLink,
  authorize: (request, channel) => authorizeDashboardUpgrade(request.headers, request.method ?? 'GET', 'admin', channel),
  channelOf: channelOfIncoming,
  timeoutMs: LINKED_UPGRADE_TIMEOUT_MS,
};

function pathnameOf(request: IncomingMessage): string {
  return new URL(request.url ?? '', 'http://localhost').pathname;
}

/** The owner's upgrade request: same handshake, link token, operator stamp, no Origin. */
export function ownerUpgradeRequest(request: IncomingMessage, kind: 'rpc' | 'terminal', token: string): string {
  const query = new URL(request.url ?? '', 'http://localhost').search;
  const lines = [
    `GET /ws/${kind}${query} HTTP/1.1`,
    'Host: link.invalid',
    'Connection: Upgrade',
    'Upgrade: websocket',
    `Authorization: Bearer ${token}`,
    `${LINK_ACTOR_HEADER}: operator`,
  ];
  for (const name of PASSED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === 'string') lines.push(`${name}: ${value}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** Read the owner's response head; resolves with its status, the head bytes and any bytes after it. */
function readResponseHead(owner: Duplex, timeoutMs: number): Promise<{ status: number; reason: string; head: Buffer; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('the owner did not answer the upgrade in time')), timeoutMs);
    timer.unref?.();
    const finish = (error: Error | null, value?: { status: number; reason: string; head: Buffer; rest: Buffer }) => {
      clearTimeout(timer);
      owner.off('data', onData);
      owner.off('error', onError);
      owner.off('close', onClose);
      if (error) reject(error);
      else resolve(value!);
    };
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buffered.length > MAX_RESPONSE_HEAD_BYTES) finish(new Error('the owner sent an oversized response head'));
        return;
      }
      const head = buffered.subarray(0, end + 4);
      const match = /^HTTP\/1\.1 (\d{3}) ?([^\r\n]*)/.exec(head.toString('latin1'));
      if (!match) return finish(new Error('the owner sent an invalid response head'));
      owner.pause();
      finish(null, { status: Number(match[1]), reason: match[2] || 'Upgrade refused', head, rest: buffered.subarray(end + 4) });
    };
    const onError = (error: Error) => finish(error);
    const onClose = () => finish(new Error('the owner closed the channel before answering'));
    owner.on('data', onData);
    owner.on('error', onError);
    owner.on('close', onClose);
  });
}

/** Pipe two sockets both ways; either ending or failing closes both. */
function joinSockets(client: Duplex, owner: Duplex): void {
  const closeBoth = () => {
    client.destroy();
    owner.destroy();
  };
  client.on('close', closeBoth);
  owner.on('close', closeBoth);
  client.on('error', closeBoth);
  owner.on('error', closeBoth);
  client.pipe(owner);
  owner.pipe(client);
  owner.resume();
}

async function relayUpgrade(
  request: IncomingMessage,
  socket: Socket,
  head: Buffer,
  match: RegExpExecArray,
  deps: LinkedWebSocketDeps,
): Promise<void> {
  const channel = deps.channelOf(request);
  if (channel !== null) return rejectUpgrade(socket, 403, 'Forbidden: a linked machine cannot reach a third machine');
  const auth = deps.authorize(request, null);
  if (!auth.ok) return rejectUpgrade(socket, auth.status, auth.message);
  const link = await deps.getLink(decodeURIComponent(match[1]!));
  if (!link || link.revokedAt !== null) return rejectUpgrade(socket, 503, 'Service Unavailable: no such machine link');
  let owner: Duplex;
  try {
    owner = await deps.openLinkSocket(link.environmentId);
  } catch (error) {
    const reason = error instanceof LinkUnavailableError ? error.code : 'machine-unreachable';
    return rejectUpgrade(socket, 503, `Service Unavailable: ${reason}`);
  }
  if (socket.destroyed) {
    owner.destroy();
    return;
  }
  owner.write(ownerUpgradeRequest(request, match[2] as 'rpc' | 'terminal', link.token));
  let answer: Awaited<ReturnType<typeof readResponseHead>>;
  try {
    answer = await readResponseHead(owner, deps.timeoutMs);
  } catch (error) {
    owner.destroy();
    return rejectUpgrade(socket, 503, `Service Unavailable: ${(error as Error).message}`);
  }
  if (answer.status !== 101) {
    owner.destroy();
    return rejectUpgrade(socket, answer.status, answer.reason);
  }
  socket.write(answer.head);
  if (answer.rest.length > 0) socket.write(answer.rest);
  if (head.length > 0) owner.write(head);
  joinSockets(socket, owner);
}

/** Handle `/ws/linked/<env>/(rpc|terminal)` upgrades on `server`; every other listener skips them. */
export function setupLinkedWebSocket(server: Server, overrides: Partial<LinkedWebSocketDeps> = {}): void {
  const deps = { ...defaultDeps, ...overrides };
  const originalOn = server.on.bind(server);
  server.on = function (event: string, listener: (...args: unknown[]) => void) {
    if (event === 'upgrade') {
      const wrapped = (request: IncomingMessage, socket: Socket, head: Buffer) => {
        if (LINKED_PATH.test(pathnameOf(request))) return;
        (listener as (req: IncomingMessage, socket: Socket, head: Buffer) => void)(request, socket, head);
      };
      return originalOn(event, wrapped as never);
    }
    return originalOn(event, listener as never);
  } as typeof server.on;

  originalOn('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const match = LINKED_PATH.exec(pathnameOf(request));
    if (!match) return;
    relayUpgrade(request, socket, head, match, deps).catch((error: unknown) => {
      if (!socket.destroyed) rejectUpgrade(socket, 500, `Internal Server Error: ${(error as Error).message}`);
    });
  });
}
