/**
 * PAN-4650 WI-7: /ws/linked/<env>/rpc relays a WebSocket to the owner's /ws/rpc
 * through the link: the owner sees the link token, the operator stamp and no
 * Origin; frames cross both ways; closing the owner closes the browser; channel
 * callers get 403 and an offline link 503. Two in-process HTTP servers stand in
 * for the machines, joined by a plain TCP socket in place of the channel.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { LinkUnavailableError } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import type { ChannelMarker } from '../channel-peer.js';
import { setupLinkedWebSocket, type LinkedWebSocketDeps } from '../ws-linked.js';

const ENV = 'env-desk';
const TOKEN = `odk_${'7'.repeat(64)}`;

const link: MachineLink = {
  id: 'link-desk', environmentId: ENV, label: 'desk', machineKey: 'ab'.repeat(32), token: TOKEN, access: 'operator',
  reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
};

const servers: Server[] = [];
const sockets: WebSocket[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

/** The owner: echoes RPC frames and records each upgrade request. */
async function owner(): Promise<{ port: number; upgrades: IncomingMessage[]; clients: WebSocket[] }> {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const upgrades: IncomingMessage[] = [];
  const clients: WebSocket[] = [];
  server.on('upgrade', (request, socket, head) => {
    upgrades.push(request);
    if (request.url !== '/ws/rpc') {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.push(ws);
      ws.on('message', (data) => ws.send(`owner:${data.toString()}`));
    });
  });
  return { port: await listen(server), upgrades, clients };
}

async function viewer(deps: Partial<LinkedWebSocketDeps>): Promise<number> {
  const server = createServer();
  setupLinkedWebSocket(server, {
    getLink: async (key) => (key === ENV ? link : null),
    authorize: () => ({ ok: true, credential: { kind: 'root-session' } }),
    channelOf: () => null,
    timeoutMs: 5_000,
    ...deps,
  });
  return listen(server);
}

function open(port: number, path: string): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  // Refused handshakes and cleanup emit errors the assertions do not need.
  ws.on('error', () => undefined);
  sockets.push(ws);
  return ws;
}

function refusal(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0)));
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  })));
});

describe('linked WebSocket pipes (PAN-4650 WI-7)', () => {
  it('relays RPC frames both ways with the link token, operator stamp and no Origin', async () => {
    const desk = await owner();
    const port = await viewer({ openLinkSocket: async () => connect(desk.port, '127.0.0.1') });
    const ws = open(port, `/ws/linked/${ENV}/rpc`);
    await new Promise((resolve) => ws.once('open', resolve));

    const reply = new Promise<string>((resolve) => ws.once('message', (data) => resolve(data.toString())));
    ws.send('{"_tag":"Request","id":"1"}');
    expect(await reply).toBe('owner:{"_tag":"Request","id":"1"}');

    const seen = desk.upgrades[0]!;
    expect(seen.url).toBe('/ws/rpc');
    expect(seen.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen.headers['x-overdeck-link-actor']).toBe('operator');
    expect(seen.headers.origin).toBeUndefined();

    const closed = new Promise((resolve) => ws.once('close', resolve));
    desk.clients[0]!.terminate();
    await closed;
  });

  it("passes the owner's refusal status through", async () => {
    const desk = await owner();
    const port = await viewer({ openLinkSocket: async () => connect(desk.port, '127.0.0.1') });
    expect(await refusal(open(port, `/ws/linked/${ENV}/terminal?session=conv-x`))).toBe(404);
    expect(desk.upgrades[0]!.url).toBe('/ws/terminal?session=conv-x');
  });

  it('answers 403 to a caller that arrived over a channel', async () => {
    const marker: ChannelMarker = { mode: 'link', remoteKeyHex: 'cd'.repeat(32), pairingId: null };
    const port = await viewer({ channelOf: () => marker, openLinkSocket: async () => { throw new Error('must not open'); } });
    expect(await refusal(open(port, `/ws/linked/${ENV}/rpc`))).toBe(403);
  });

  it('answers 503 for an offline link and an unknown machine', async () => {
    const port = await viewer({ openLinkSocket: async () => { throw new LinkUnavailableError('machine-offline', 'desk is offline'); } });
    expect(await refusal(open(port, `/ws/linked/${ENV}/rpc`))).toBe(503);
    expect(await refusal(open(port, '/ws/linked/env-unknown/rpc'))).toBe(503);
  });

  it('answers the local auth status', async () => {
    const port = await viewer({ authorize: () => ({ ok: false, status: 401, message: 'Unauthorized' }) });
    expect(await refusal(open(port, `/ws/linked/${ENV}/rpc`))).toBe(401);
  });
});
