/**
 * The viewer's half of a port forward (PAN-4650 WI-18, FR-7, D-4650-16).
 *
 * `startForward(environmentId, port)` first probes the owner's `/ws/forward`
 * upgrade, so a refused port fails (403 `port-refused`) before anything
 * listens here. It then listens on `127.0.0.1:<free port>`; each accepted
 * TCP connection opens its own secure channel and `/ws/forward` WebSocket to
 * the owner and pipes bytes both ways. A forward closes on `stopForward`, when
 * its link goes away, or after 30 minutes with no open connection.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { createWebSocketStream, WebSocket } from 'ws';

import { LINK_ACTOR_HEADER } from '../../../lib/anywhere/link-actor.js';
import { openLinkSocket } from '../../../lib/anywhere/link-client.js';
import { getLink, type MachineLink } from '../../../lib/anywhere/link-store.js';

export const FORWARD_IDLE_MS = 30 * 60_000;
const PROBE_TIMEOUT_MS = 10_000;

export interface ForwardView {
  id: string;
  environmentId: string;
  label: string;
  port: number;
  localPort: number;
  url: string;
  connections: number;
  createdAt: string;
}

interface Forward extends ForwardView {
  server: Server;
  sockets: Set<Socket>;
  idleTimer: NodeJS.Timeout | null;
}

export interface PortForwardDeps {
  getLink: (idOrEnvOrLabel: string) => Promise<MachineLink | null>;
  openSocket: (environmentId: string) => Promise<Duplex>;
}

const defaultDeps: PortForwardDeps = { getLink, openSocket: (environmentId) => openLinkSocket(environmentId) };

export class ForwardRefusedError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'ForwardRefusedError';
  }
}

const forwards = new Map<string, Forward>();

/** A `/ws/forward` WebSocket to the owner over a fresh channel. */
async function openForwardSocket(link: MachineLink, port: number, deps: PortForwardDeps): Promise<WebSocket> {
  const channel = await deps.openSocket(link.environmentId);
  return new WebSocket(`ws://link.invalid/ws/forward?port=${port}`, {
    createConnection: () => channel as unknown as Socket,
    headers: { authorization: `Bearer ${link.token}`, [LINK_ACTOR_HEADER]: 'operator' },
    perMessageDeflate: false,
  });
}

/** Resolve when the owner accepts the upgrade; reject with its refusal otherwise. */
function awaitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new ForwardRefusedError(504, 'machine-unreachable', 'The other machine did not answer the forward')); }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      let body = '';
      response.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      response.on('end', () => {
        let parsed: { error?: string; code?: string } = {};
        try { parsed = JSON.parse(body) as typeof parsed; } catch { /* a plain-text refusal */ }
        reject(new ForwardRefusedError(response.statusCode ?? 502, parsed.code ?? 'forward-refused', parsed.error ?? `The other machine answered ${response.statusCode}`));
      });
    });
    ws.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function view(forward: Forward): ForwardView {
  const { server: _server, sockets: _sockets, idleTimer: _idle, ...rest } = forward;
  return { ...rest, connections: forward.sockets.size };
}

function armIdle(forward: Forward): void {
  if (forward.idleTimer) clearTimeout(forward.idleTimer);
  forward.idleTimer = null;
  if (forward.sockets.size > 0) return;
  forward.idleTimer = setTimeout(() => stopForward(forward.id), FORWARD_IDLE_MS);
  forward.idleTimer.unref?.();
}

function relay(forward: Forward, link: MachineLink, client: Socket, deps: PortForwardDeps): void {
  forward.sockets.add(client);
  armIdle(forward);
  client.pause();
  let remote: WebSocket | null = null;
  let stream: Duplex | null = null;
  // Either side ending closes both, including the WebSocket to the owner.
  const done = () => {
    client.destroy();
    stream?.destroy();
    remote?.terminate();
    if (forward.sockets.delete(client)) armIdle(forward);
  };
  client.on('close', done);
  client.on('error', done);
  void openForwardSocket(link, forward.port, deps)
    .then(async (ws) => {
      remote = ws;
      if (client.destroyed) return done();
      await awaitOpen(ws);
      stream = createWebSocketStream(ws);
      stream.on('error', done);
      stream.on('close', done);
      stream.pipe(client);
      client.pipe(stream);
      client.resume();
    })
    .catch(done);
}

/** Probe, then listen on 127.0.0.1. Rejects with `ForwardRefusedError` for a refused port. */
export async function startForward(idOrEnvOrLabel: string, port: number, overrides: Partial<PortForwardDeps> = {}): Promise<ForwardView> {
  const deps = { ...defaultDeps, ...overrides };
  const link = await deps.getLink(idOrEnvOrLabel);
  if (!link || link.revokedAt !== null) throw new ForwardRefusedError(404, 'no-link', `No machine link matches ${idOrEnvOrLabel}`);
  const probe = await openForwardSocket(link, port, deps);
  await awaitOpen(probe);
  probe.close();

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const localPort = (server.address() as AddressInfo).port;
  const forward: Forward = {
    id: randomUUID(),
    environmentId: link.environmentId,
    label: link.label,
    port,
    localPort,
    url: `http://127.0.0.1:${localPort}`,
    connections: 0,
    createdAt: new Date().toISOString(),
    server,
    sockets: new Set(),
    idleTimer: null,
  };
  server.on('connection', (client) => relay(forward, link, client, deps));
  forwards.set(forward.id, forward);
  armIdle(forward);
  return view(forward);
}

export function listForwards(): ForwardView[] {
  return [...forwards.values()].map(view);
}

/** Close a forward and every connection through it; false when unknown. */
export function stopForward(id: string): boolean {
  const forward = forwards.get(id);
  if (!forward) return false;
  forwards.delete(id);
  if (forward.idleTimer) clearTimeout(forward.idleTimer);
  for (const socket of forward.sockets) socket.destroy();
  forward.server.close();
  return true;
}

/** Close the forwards of environments with no active link (called from the link reconcile). */
export function stopForwardsWithoutLink(activeEnvironmentIds: readonly string[]): void {
  const active = new Set(activeEnvironmentIds);
  for (const forward of [...forwards.values()]) {
    if (!active.has(forward.environmentId)) stopForward(forward.id);
  }
}

export function _resetForwardsForTests(): void {
  for (const id of [...forwards.keys()]) stopForward(id);
}
