/**
 * PAN-4645 WI-3: the first-byte dispatcher on the dashboard port leaves HTTP,
 * keep-alive and WebSocket traffic untouched, routes `0x00` sockets through
 * `acceptChannel`, tags channel requests with a `link:` remote address, and
 * refuses the 33rd pending handshake with code 04.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import { connect, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FrameReader } from '@overdeck/anywhere-channel';
import { createWebSocketStream, WebSocket as WsClient, WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  createAccessToken,
  findActiveChannelTokenByKey,
  PHONE_TOKEN_SCOPES,
  revokeAccessToken,
} from '../../../lib/access-tokens.js';
import type { MachineKeyPair } from '../../../lib/anywhere/machine-key.js';
import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import { openChannel, openChannelOverTransport } from '../../../lib/anywhere/channel/open.js';
import { channelRequest } from '../services/machine-link-service.js';
import {
  _resetChannelListenerForTests,
  type ChannelListenerDeps,
  closeChannelsForPeer,
  installChannelListener,
  liveChannelCount,
} from '../channel-listener.js';
import { channelOfIncoming } from '../channel-peer.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };
const hex = (key: MachineKeyPair): string => key.publicKey.toString('hex');

const serverKey = dh.generateKeyPair();
const peerKey = dh.generateKeyPair();

interface Seen {
  method: string;
  url: string;
  remoteAddress: string | undefined;
  channel: ReturnType<typeof channelOfIncoming>;
  socket: object;
}

let server: http.Server;
let seen: Seen[];
let port: number;
const cleanups: Array<() => Promise<void> | void> = [];

function deps(overrides: Partial<ChannelListenerDeps> = {}): ChannelListenerDeps {
  return {
    primary: true,
    localKey: async () => serverKey,
    isPinnedPeer: (key) => key === hex(peerKey),
    takePairing: () => 'unknown',
    onPairingFailure: () => undefined,
    serverVersion: async () => '0.0.0-test',
    log: () => undefined,
    ...overrides,
  };
}

async function start(listenerDeps: ChannelListenerDeps): Promise<void> {
  seen = [];
  server = http.createServer((req, res) => {
    seen.push({ method: req.method ?? '', url: req.url ?? '', remoteAddress: req.socket.remoteAddress, channel: channelOfIncoming(req), socket: req.socket });
    let bytes = 0;
    req.on('data', (chunk: Buffer) => { bytes += chunk.length; });
    req.on('end', () => res.end(req.method === 'POST' ? `ok ${req.url} ${bytes}` : `ok ${req.url}`));
  });
  installChannelListener(server, listenerDeps);
  // Effect registers its upgrade handler after the factory ran; mirror that order.
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '', 'http://x').pathname !== '/ws/echo') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket as Socket, head, (ws) => ws.on('message', (data) => ws.send(`echo ${String(data)}`)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
  cleanups.push(() => new Promise<void>((resolve) => { wss.close(); server.close(() => resolve()); }));
}

function get(path: string, agent?: http.Agent): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    }).on('error', reject);
  });
}

function post(path: string, body: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-length': String(body.length) } }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function requestOverChannel(channel: ChannelSocket, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get({ host: 'link.invalid', path, createConnection: () => channel as unknown as Socket }, (res) => {
      let text = '';
      res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
      res.on('end', () => resolve(text));
    }).on('error', reject);
  });
}

beforeEach(() => {
  _resetChannelListenerForTests();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  _resetChannelListenerForTests();
});

describe('channel listener (PAN-4645 WI-3)', () => {
  it('leaves a plain HTTP GET, a keep-alive pair, a 200 KB POST and a WebSocket upgrade untouched', async () => {
    await start(deps());

    const single = await get('/plain');
    expect(single).toEqual({ status: 200, text: 'ok /plain' });
    expect(await post('/upload', Buffer.alloc(200 * 1024, 0x78))).toBe(`ok /upload ${200 * 1024}`);
    seen.length = 0;

    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(() => agent.destroy());
    const first = await get('/keep-1', agent);
    const second = await get('/keep-2', agent);
    expect(first.text).toBe('ok /keep-1');
    expect(second.text).toBe('ok /keep-2');
    expect(seen).toHaveLength(2);
    expect(seen[0]!.socket).toBe(seen[1]!.socket);
    for (const entry of seen) {
      expect(entry.remoteAddress).toBe('127.0.0.1');
      expect(entry.channel).toBeNull();
    }

    const ws = new WsClient(`ws://127.0.0.1:${port}/ws/echo`);
    cleanups.push(() => ws.terminate());
    const echoed = await new Promise<string>((resolve, reject) => {
      ws.once('open', () => ws.send('ping'));
      ws.once('message', (data) => resolve(String(data)));
      ws.once('error', reject);
    });
    expect(echoed).toBe('echo ping');
    expect(liveChannelCount()).toBe(0);
  });

  it('routes a 0x00 socket through acceptChannel and tags its requests with a link: address', async () => {
    await start(deps());

    const channel = await openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey) });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);

    expect(await requestOverChannel(channel, '/api/over-channel')).toBe('ok /api/over-channel');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.remoteAddress).toBe(`link:${hex(peerKey).slice(0, 16)}`);
    expect(seen[0]!.channel).toEqual({ mode: 'link', remoteKeyHex: hex(peerKey), pairingId: null });

    // Plain HTTP still works beside the channel, and is not marked.
    expect((await get('/beside')).text).toBe('ok /beside');
    expect(seen[1]!.channel).toBeNull();
  });

  it('closeChannelsForPeer ends that peer\'s channels and the client sees the close', async () => {
    await start(deps());
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    cleanups.push(() => agent.destroy());

    const channel = await openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey) });
    (agent as unknown as { createConnection: () => Socket }).createConnection = () => channel as unknown as Socket;
    expect((await get('/first', agent)).text).toBe('ok /first');
    expect(liveChannelCount()).toBe(1);

    const closed = new Promise<void>((resolve) => channel.once('close', resolve));
    expect(closeChannelsForPeer(hex(peerKey))).toBe(1);
    await closed;
    expect(liveChannelCount()).toBe(0);
    expect(closeChannelsForPeer(hex(peerKey))).toBe(0);
  });

  it('accepts a channel over a /ws/link upgrade', async () => {
    await start(deps());
    const ws = new WsClient(`ws://127.0.0.1:${port}/ws/link`);
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
    const channel = await openChannelOverTransport(createWebSocketStream(ws), { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey) });
    cleanups.push(() => channel.destroy());

    expect(await requestOverChannel(channel, '/via-ws-link')).toBe('ok /via-ws-link');
    expect(seen[0]!.remoteAddress).toBe(`link:${hex(peerKey).slice(0, 16)}`);
    expect(liveChannelCount()).toBe(1);
  });

  it('refuses the 33rd pending handshake with code 04 (busy)', async () => {
    await start(deps({ maxPending: 32 }));
    const stalled: Socket[] = [];
    cleanups.push(() => { for (const socket of stalled) socket.destroy(); });
    for (let i = 0; i < 32; i += 1) {
      const socket = connect({ host: '127.0.0.1', port });
      stalled.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
      socket.write(Buffer.from([0x00, 0x4f])); // preamble start, never finished
    }

    const probe = connect({ host: '127.0.0.1', port });
    cleanups.push(() => probe.destroy());
    await new Promise<void>((resolve) => probe.once('connect', resolve));
    const reader = new FrameReader(probe);
    probe.write(Buffer.from([0x00]));
    expect(await reader.readFrame()).toEqual({ kind: 'refusal', refusal: { code: 4 } });
    reader.detach();

    await expect(openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey), timeoutMs: 2_000 }))
      .rejects.toMatchObject({ code: 'busy' });
  });

  it('installs nothing on a peer dashboard: a 0x00 socket is just bad HTTP', async () => {
    await start(deps({ primary: false }));
    await expect(openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey), timeoutMs: 2_000 }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(protocol|identity-refused|timeout)$/) });
    expect(liveChannelCount()).toBe(0);
    expect((await get('/still-http')).text).toBe('ok /still-http');
  });
});

describe('isPinnedPeer via findActiveChannelTokenByKey (PAN-4835 WI-3)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;
  const phoneKeyPair = dh.generateKeyPair();

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pan-4835-channel-listener-'));
    process.env.OVERDECK_HOME = home;
    _resetAccessTokensForTests();
  });

  afterEach(async () => {
    await _settleAccessTokenWritesForTests();
    _resetAccessTokensForTests();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  it('accepts a link-mode handshake from a key an active phone record pins', async () => {
    await createAccessToken({
      name: 'phone:iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: hex(phoneKeyPair), clientId: '11111111-1111-4111-8111-111111111111',
    });
    await start(deps({ isPinnedPeer: (key) => findActiveChannelTokenByKey(key) !== null }));

    const channel = await openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: phoneKeyPair, remoteKeyHex: hex(serverKey) });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);
    expect(await requestOverChannel(channel, '/api/environment')).toBe('ok /api/environment');
  });

  it('refuses the handshake with unknown-peer once the phone record is revoked', async () => {
    const { record } = await createAccessToken({
      name: 'phone:iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: hex(phoneKeyPair), clientId: '11111111-1111-4111-8111-111111111111',
    });
    await revokeAccessToken(record.id);
    await start(deps({ isPinnedPeer: (key) => findActiveChannelTokenByKey(key) !== null }));

    await expect(openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: phoneKeyPair, remoteKeyHex: hex(serverKey), timeoutMs: 2_000 }))
      .rejects.toMatchObject({ code: 'unknown-peer' });
    expect(liveChannelCount()).toBe(0);
  });
});

// PAN-4645 WI-21 regression: a plain http.request with only createConnection has no
// agent and sends `Connection: close`, so the peer ended the channel after the first
// answer and the pairing exchange's second request hung. channelRequest now rides a
// per-channel keep-alive agent.
describe('channelRequest keeps the channel alive across requests', () => {
  it('serves two consecutive requests over one channel and leaves it open', async () => {
    await start(deps());
    const channel = await openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey) });
    cleanups.push(() => channel.destroy());

    const first = await channelRequest(channel, 'GET', '/api/environment');
    const second = await channelRequest(channel, 'POST', '/api/machines/exchange', { v: 1 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.json as { text: string }).text).toBe('ok /api/machines/exchange 7');
    expect(seen.map((entry) => entry.url)).toEqual(['/api/environment', '/api/machines/exchange']);
    expect(seen[0]!.socket).toBe(seen[1]!.socket); // the same channel carried both
    expect(channel.destroyed).toBe(false);
  });

  it('rejects at once when the channel is already closed', async () => {
    await start(deps());
    const channel = await openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: hex(serverKey) });
    await channelRequest(channel, 'GET', '/api/environment');
    channel.destroy();
    await new Promise((resolve) => channel.once('close', resolve));
    await expect(channelRequest(channel, 'GET', '/api/environment')).rejects.toThrow(/closed|destroyed|hang up/);
  });
});
