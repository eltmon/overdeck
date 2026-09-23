/**
 * PAN-3835 — the native Unix-socket WebSocket transport the conversation host
 * uses so the Codex TUI can attach to the same app-server.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  connectUnixWebSocketTransport,
  createStdioTransport,
  nativeEndpointUrl,
} from '../app-server-transport.js';

let dir: string | undefined;
let server: Server | undefined;
let wss: WebSocketServer | undefined;

afterEach(async () => {
  wss?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
  server = undefined;
  wss = undefined;
});

/** A codex-like server: rejects permessage-deflate offers, echoes JSON frames. */
async function listenFakeServer(): Promise<{ socketPath: string; clients: WebSocket[]; offers: Array<string | undefined> }> {
  dir = mkdtempSync(join(tmpdir(), 'pan3835-ws-'));
  const socketPath = join(dir, 'app.sock');
  const clients: WebSocket[] = [];
  const offers: Array<string | undefined> = [];
  server = createServer();
  wss = new WebSocketServer({ server, perMessageDeflate: false });
  server.on('upgrade', (request) => offers.push(request.headers['sec-websocket-extensions']));
  wss.on('connection', (socket) => {
    clients.push(socket);
    socket.on('message', (data) => socket.send(JSON.stringify({ echo: JSON.parse(String(data)) })));
  });
  await new Promise<void>(resolve => server!.listen(socketPath, resolve));
  return { socketPath, clients, offers };
}

describe('connectUnixWebSocketTransport', () => {
  it('exchanges one JSON message per frame over the Unix socket without offering compression', async () => {
    const fake = await listenFakeServer();
    const transport = await connectUnixWebSocketTransport(fake.socketPath);
    const received: string[] = [];
    transport.onMessage(text => received.push(text));

    transport.send({ id: 1, method: 'initialize' });

    await expect.poll(() => received).toEqual([JSON.stringify({ echo: { id: 1, method: 'initialize' } })]);
    // codex app-server 0.153.4 hangs up on a permessage-deflate offer.
    expect(fake.offers).toEqual([undefined]);
    transport.close();
  });

  it('reports the server closing the connection', async () => {
    const fake = await listenFakeServer();
    const transport = await connectUnixWebSocketTransport(fake.socketPath);
    const closed: string[] = [];
    transport.onClose(reason => closed.push(reason));

    fake.clients[0]?.close();

    await expect.poll(() => closed.length).toBe(1);
    expect(() => transport.send({ id: 2 })).toThrow('native socket is closed');
  });

  it('retries until the freshly spawned server binds its socket', async () => {
    const fake = await listenFakeServer();
    let attempts = 0;
    const slept: number[] = [];
    let clock = 0;
    const transport = await connectUnixWebSocketTransport(fake.socketPath, {
      retryDelayMs: 100,
      sleep: async (ms) => { slept.push(ms); clock += ms; },
      now: () => clock,
      createSocket: (url) => {
        attempts += 1;
        // The first two attempts target a socket that does not exist yet.
        const target = attempts <= 2 ? url.replace('app.sock', 'missing.sock') : url;
        return new WebSocket(target, { perMessageDeflate: false });
      },
    });
    expect(attempts).toBe(3);
    expect(slept).toEqual([100, 100]);
    transport.close();
  });

  it('gives up with the endpoint and the last error once the deadline passes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pan3835-ws-'));
    const socketPath = join(dir, 'never.sock');
    let clock = 0;
    await expect(connectUnixWebSocketTransport(socketPath, {
      timeoutMs: 1_000,
      retryDelayMs: 250,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    })).rejects.toThrow(`Could not connect to codex app-server at ${nativeEndpointUrl(socketPath)} within 1000ms`);
    expect(clock).toBe(1_000);
  });
});

describe('createStdioTransport', () => {
  it('frames newline-delimited JSON on the child pipes', () => {
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    const transport = createStdioTransport(stdout, stdin);
    const lines: string[] = [];
    const written: string[] = [];
    stdin.on('data', chunk => written.push(String(chunk)));
    transport.onMessage(line => lines.push(line));

    transport.send({ id: 1 });
    stdout.write('{"id":1,"result":{}}\n');

    return expect.poll(() => [written, lines]).toEqual([['{"id":1}\n'], ['{"id":1,"result":{}}']]);
  });

  it('refuses writes after close', () => {
    const transport = createStdioTransport(new PassThrough(), Object.assign(new EventEmitter(), { writable: false }) as never);
    expect(() => transport.send({ id: 1 })).toThrow('Cannot write to codex app-server stdin.');
  });
});
