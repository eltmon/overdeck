/**
 * PAN-4834 WI-7 (pan-4823 AC-6): the phone's HTTP/1.1 pool, channel WebSocket and page
 * shims against the real channel listener. Every request crosses a real Noise link
 * handshake (`openSecureChannel` → `acceptRawChannel`) into a real Node HTTP server and a
 * `ws` server, the way a WebRTC data channel reaches a machine.
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { duplexPair } from 'node:stream';

import {
  type ChannelPool,
  type ChannelStream,
  ChannelWebSocket,
  createChannelPool,
  installChannelShims,
  openSecureChannel,
} from '@overdeck/anywhere-channel/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';

import type { MachineKeyPair } from '../../../src/lib/anywhere/machine-key.js';
import {
  _resetChannelListenerForTests,
  acceptRawChannel,
  installChannelListener,
  liveChannelCount,
} from '../../../src/dashboard/server/channel-listener.js';

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const serverKey = dh.generateKeyPair();
const webKey = dh.generateKeyPair();
const serverKeyHex = serverKey.publicKey.toString('hex');
const webKeyHex = webKey.publicKey.toString('hex');

const decoder = new TextDecoder();
const text = (bytes: Uint8Array): string => decoder.decode(bytes);

let server: http.Server;
let wss: WebSocketServer;
let liveWhileHeld = -1;
const closers: Array<() => void> = [];

/** Opens one link channel to the machine, as the phone's dialer does over a data channel. */
const dial = vi.fn(async (): Promise<ChannelStream> => {
  const [a, b] = duplexPair();
  a.once('close', () => b.destroy());
  b.once('close', () => a.destroy());
  closers.push(() => a.destroy());
  void acceptRawChannel(a);
  const channel = await openSecureChannel(b, { mode: 'link', localKey: webKey, remoteKeyHex: serverKeyHex });
  return channel.stream;
});

beforeEach(async () => {
  _resetChannelListenerForTests();
  dial.mockClear();
  liveWhileHeld = -1;
  const held: Array<() => void> = [];
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      switch (req.url) {
        case '/api/hello':
          res.end('hello');
          return;
        case '/api/chunked':
          res.write('one,');
          res.write('two,');
          res.write('three');
          res.end();
          return;
        case '/api/echo':
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              method: req.method,
              bytes: Buffer.concat(chunks).length,
              authorization: req.headers.authorization ?? null,
              contentType: req.headers['content-type'] ?? null,
            }),
          );
          return;
        case '/api/hold':
          // Answer only once both requests are in: proves they ran on two channels at once.
          held.push(() => res.end('held'));
          if (held.length === 2) {
            liveWhileHeld = liveChannelCount();
            for (const release of held.splice(0)) release();
          }
          return;
        case '/api/empty':
          res.statusCode = 204;
          res.end();
          return;
        default:
          res.statusCode = 404;
          res.end();
      }
    });
  });
  installChannelListener(server, {
    primary: true,
    localKey: async () => serverKey,
    isPinnedPeer: (key) => key === webKeyHex,
    takePairing: () => 'unknown',
    onPairingFailure: () => {},
    log: () => {},
  });
  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/echo') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket as Socket, head, (ws) => {
      ws.on('message', (data, isBinary) => {
        if (!isBinary && String(data) === 'close-me') ws.close(4401, 'revoked');
        else ws.send(data, { binary: isBinary });
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) close();
  _resetChannelListenerForTests();
  wss.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function pool(): ChannelPool {
  const created = createChannelPool({ dial });
  closers.push(() => created.close());
  return created;
}

function socket(url: string): ChannelWebSocket {
  const created = new ChannelWebSocket(url, undefined, { dial, bearerToken: 'phone-token' });
  closers.push(() => {
    if (created.readyState === ChannelWebSocket.OPEN) created.close();
  });
  return created;
}

function next<E extends Event>(target: EventTarget, type: string): Promise<E> {
  return new Promise((resolve) => target.addEventListener(type, (event) => resolve(event as E), { once: true }));
}

describe('phone channel clients against the real channel listener', () => {
  it('GETs a content-length body through the pool', async () => {
    const response = await pool().request({ method: 'GET', path: '/api/hello' });
    expect(response.status).toBe(200);
    expect(text(response.body)).toBe('hello');
  });

  it('GETs a chunked body through the pool', async () => {
    const response = await pool().request({ method: 'GET', path: '/api/chunked' });
    expect(response.headers).toContainEqual(['transfer-encoding', 'chunked']);
    expect(text(response.body)).toBe('one,two,three');
  });

  it('POSTs 64 KiB through the pool', async () => {
    const body = new Uint8Array(64 * 1024).fill(7);
    const response = await pool().request({ method: 'POST', path: '/api/echo', body });
    expect(JSON.parse(text(response.body))).toMatchObject({ method: 'POST', bytes: 65536 });
  });

  it('runs two concurrent requests on two live channels', async () => {
    const channels = pool();
    const responses = await Promise.all([
      channels.request({ method: 'GET', path: '/api/hold' }),
      channels.request({ method: 'GET', path: '/api/hold' }),
    ]);
    expect(responses.map((response) => text(response.body))).toEqual(['held', 'held']);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(liveWhileHeld).toBe(2);
  });

  it('reuses one channel for three sequential requests', async () => {
    const channels = pool();
    for (let i = 0; i < 3; i++) {
      expect(text((await channels.request({ method: 'GET', path: '/api/hello' })).body)).toBe('hello');
    }
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it('echoes text and binary over a channel WebSocket and surfaces a 4401 close', async () => {
    const ws = socket('ws://localhost/ws/echo');
    await next(ws, 'open');
    ws.send('ping');
    expect((await next<MessageEvent>(ws, 'message')).data).toBe('ping');
    ws.binaryType = 'arraybuffer';
    ws.send(Uint8Array.of(1, 2, 3));
    const binary = (await next<MessageEvent>(ws, 'message')).data as ArrayBuffer;
    expect(new Uint8Array(binary)).toEqual(Uint8Array.of(1, 2, 3));
    const closed = next<CloseEvent>(ws, 'close');
    ws.send('close-me');
    expect(await closed).toMatchObject({ code: 4401, reason: 'revoked', wasClean: true });
  });

  it('routes the page shims through the channel and leaves external URLs alone', async () => {
    const originalFetch = vi.fn(async () => new Response('external'));
    const target = { fetch: originalFetch, WebSocket: class {} } as unknown as {
      fetch: typeof fetch;
      WebSocket: typeof WebSocket;
    };
    const uninstall = installChannelShims({
      currentMachine: () => ({ environmentId: 'env-1', bearerToken: 'phone-token', dial }),
      target,
      location: { protocol: 'capacitor:', host: 'localhost', href: 'capacitor://localhost/m' },
    });
    closers.push(uninstall);

    const echo = await target.fetch('/api/echo', { method: 'POST', body: 'x' });
    expect(await echo.json()).toMatchObject({ method: 'POST', bytes: 1, authorization: 'Bearer phone-token' });

    const empty = await target.fetch('/api/empty');
    expect(empty.status).toBe(204);
    expect(empty.body).toBeNull();

    const ws = new target.WebSocket('ws://localhost/ws/echo');
    closers.push(() => ws.readyState === 1 && ws.close());
    await next(ws, 'open');
    ws.send('through the shim');
    expect((await next<MessageEvent>(ws, 'message')).data).toBe('through the shim');

    expect(await (await target.fetch('https://connect.overdeck.ai/healthz')).text()).toBe('external');
    expect(originalFetch).toHaveBeenCalledWith('https://connect.overdeck.ai/healthz');
  });
});
