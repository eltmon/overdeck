/** PAN-4834 WI-5: the fetch and WebSocket page shims and their routing rule. */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { type Duplex, duplexPair } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { channelPathFor, installChannelShims, type ShimLocation, type ShimMachine, type ShimTarget } from '../shims.js';
import { ChannelWebSocket } from '../ws-client.js';
import { acceptFor } from '../ws-frames.js';

const CAPACITOR: ShimLocation = { protocol: 'capacitor:', host: 'localhost', href: 'capacitor://localhost/m' };
const HTTPS: ShimLocation = { protocol: 'https:', host: 'localhost', href: 'https://localhost/m' };

describe('channelPathFor', () => {
  it.each<[string, 'fetch' | 'websocket', string | null]>([
    ['/api/x?a=1', 'fetch', '/api/x?a=1'],
    ['/api/x#frag', 'fetch', '/api/x'],
    ['capacitor://localhost/ws/rpc', 'websocket', '/ws/rpc'],
    ['capacitor://localhost/api/x', 'fetch', '/api/x'],
    ['ws://localhost/ws/rpc', 'websocket', '/ws/rpc'],
    ['wss://localhost/ws/rpc', 'websocket', '/ws/rpc'],
    ['ws://localhost/ws/rpc', 'fetch', null],
    ['wss://connect.overdeck.ai/v1/directory', 'websocket', null],
    ['https://localhost/api/x', 'fetch', null],
    ['capacitor://other/api/x', 'fetch', null],
    ['/m/needs-you', 'fetch', null],
    ['/apix', 'fetch', null],
  ])('on a capacitor page routes %s (%s) to %s', (input, kind, expected) => {
    expect(channelPathFor(input, CAPACITOR, kind)).toBe(expected);
  });

  it.each<[string, 'fetch' | 'websocket', string | null]>([
    ['/api/x?a=1', 'fetch', '/api/x?a=1'],
    ['https://localhost/api/x', 'fetch', '/api/x'],
    ['ws://localhost/ws/rpc', 'websocket', '/ws/rpc'],
    ['ws://localhost/ws/rpc', 'fetch', null],
    ['wss://connect.overdeck.ai/v1/directory', 'websocket', null],
    ['capacitor://localhost/api/x', 'fetch', null],
    ['/m/needs-you', 'fetch', null],
    ['/apix', 'fetch', null],
  ])('on an https page routes %s (%s) to %s', (input, kind, expected) => {
    expect(channelPathFor(input, HTTPS, kind)).toBe(expected);
  });
});

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const open: Duplex[] = [];
const servers: Server[] = [];
const uninstalls: Array<() => void> = [];

afterEach(() => {
  for (const uninstall of uninstalls.splice(0)) uninstall();
  for (const stream of open.splice(0)) stream.destroy();
  for (const server of servers.splice(0)) server.close();
});

/** A machine whose channels reach a real Node HTTP server; `seen` records every request. */
function machine(environmentId: string, reply: (seen: Seen) => { status?: number; body?: string } = () => ({ body: 'ok' })) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const entry = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      seen.push(entry);
      const { status = 200, body } = reply(entry);
      res.statusCode = status;
      res.end(body);
    });
  });
  server.on('upgrade', (req: { headers: IncomingHttpHeaders; url?: string }, socket: Duplex) => {
    seen.push({ method: 'UPGRADE', url: req.url!, headers: req.headers, body: Buffer.alloc(0) });
    const accept = acceptFor(String(req.headers['sec-websocket-key']));
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  servers.push(server);
  const dial = vi.fn(async () => {
    const [client, serverEnd] = duplexPair();
    client.once('close', () => serverEnd.destroy());
    serverEnd.once('close', () => client.destroy());
    open.push(client, serverEnd);
    server.emit('connection', serverEnd);
    return client;
  });
  const shimMachine: ShimMachine = { environmentId, bearerToken: `${environmentId}-token`, dial };
  return { machine: shimMachine, seen, dial };
}

/** A fake page: its own fetch and WebSocket, with the shims installed over them. */
function page(currentMachine: () => ShimMachine | null) {
  const originalFetch = vi.fn(async () => new Response('from the network'));
  const OriginalWebSocket = vi.fn(function (this: { url: string }, url: string) {
    this.url = url;
  });
  const target = { fetch: originalFetch, WebSocket: OriginalWebSocket } as unknown as ShimTarget;
  const uninstall = installChannelShims({ currentMachine, target, location: CAPACITOR });
  uninstalls.push(uninstall);
  return { target, originalFetch, OriginalWebSocket, uninstall };
}

describe('installChannelShims', () => {
  it('sends a relative fetch through the channel with the bearer token and no Origin', async () => {
    const m = machine('env-a', () => ({ body: 'machine says hi' }));
    const { target, originalFetch } = page(() => m.machine);
    const response = await target.fetch('/api/issues?limit=1', { headers: { Origin: 'capacitor://localhost', Authorization: 'Bearer stale' } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('machine says hi');
    expect(m.seen[0].url).toBe('/api/issues?limit=1');
    expect(m.seen[0].headers.authorization).toBe('Bearer env-a-token');
    expect(m.seen[0].headers.host).toBe('link.invalid');
    expect(m.seen[0].headers.origin).toBeUndefined();
    expect(response.headers.get('transfer-encoding')).toBeNull();
    expect(response.headers.get('connection')).toBeNull();
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it('sends a relative POST with the bearer token and returns the server status and body', async () => {
    const m = machine('env-a', (seen) => ({ status: 201, body: `got ${seen.body.toString()}` }));
    const { target } = page(() => m.machine);
    const response = await target.fetch('/api/echo', { method: 'POST', body: 'payload' });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('got payload');
    const [seen] = m.seen;
    expect(seen.method).toBe('POST');
    expect(seen.headers.authorization).toBe('Bearer env-a-token');
    expect(seen.headers.host).toBe('link.invalid');
    expect(seen.headers.origin).toBeUndefined();
  });

  it('closes every pool on uninstall', async () => {
    const m = machine('env-a');
    const { target, uninstall } = page(() => m.machine);
    await target.fetch('/api/x');
    const channel = (await m.dial.mock.results[0].value) as Duplex;
    expect(channel.destroyed).toBe(false);
    uninstall();
    expect(channel.destroyed).toBe(true);
  });

  it('passes an external fetch to the original unchanged', async () => {
    const m = machine('env-a');
    const { target, originalFetch } = page(() => m.machine);
    const init = { headers: { accept: 'application/json' } };
    const response = await target.fetch('https://api.github.com/repos/x', init);
    expect(await response.text()).toBe('from the network');
    expect(originalFetch).toHaveBeenCalledWith('https://api.github.com/repos/x', init);
    expect(init.headers).toEqual({ accept: 'application/json' });
    expect(m.dial).not.toHaveBeenCalled();
  });

  it('sends a FormData POST as multipart with the file bytes', async () => {
    const m = machine('env-a');
    const { target } = page(() => m.machine);
    const form = new FormData();
    form.append('image', new Blob([Uint8Array.of(0x89, 0x50, 0x4e, 0x47)], { type: 'image/png' }), 'shot.png');
    await target.fetch('/api/conversations/c1/upload-image', { method: 'POST', body: form });
    const [seen] = m.seen;
    expect(seen.method).toBe('POST');
    expect(seen.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen.body.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(seen.body.toString('latin1')).toContain('filename="shot.png"');
  });

  it('resolves a 204 to a Response with a null body', async () => {
    const m = machine('env-a', () => ({ status: 204 }));
    const { target } = page(() => m.machine);
    const response = await target.fetch('/api/nothing', { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('sends a Request input with its POST body', async () => {
    const m = machine('env-a');
    const { target } = page(() => m.machine);
    await target.fetch(new Request('capacitor://localhost/api/echo', { method: 'POST', body: 'abc' }));
    expect(m.seen[0].url).toBe('/api/echo');
    expect(m.seen[0].body.toString()).toBe('abc');
    expect(m.seen[0].headers.authorization).toBe('Bearer env-a-token');
  });

  it('rejects with TypeError when no machine is selected', async () => {
    const { target } = page(() => null);
    const failure = await target.fetch('/api/x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect(((failure as TypeError).cause as Error).message).toBe('No machine is selected');
  });

  it('rejects a channel failure as TypeError Failed to fetch', async () => {
    const m = machine('env-a');
    m.dial.mockRejectedValueOnce(new Error('relay unreachable'));
    const { target } = page(() => m.machine);
    const failure = await target.fetch('/api/x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as TypeError).message).toBe('Failed to fetch');
  });

  it('sends each request to the machine selected at the time', async () => {
    const a = machine('env-a', () => ({ body: 'A' }));
    const b = machine('env-b', () => ({ body: 'B' }));
    let current = a.machine;
    const { target } = page(() => current);
    expect(await (await target.fetch('/api/who')).text()).toBe('A');
    current = b.machine;
    expect(await (await target.fetch('/api/who')).text()).toBe('B');
    current = a.machine;
    expect(await (await target.fetch('/api/who')).text()).toBe('A');
    expect(b.seen[0].headers.authorization).toBe('Bearer env-b-token');
    expect(a.seen.map((seen) => seen.headers.authorization)).toEqual(['Bearer env-a-token', 'Bearer env-a-token']);
  });

  it('opens a relative WebSocket through the channel', async () => {
    const m = machine('env-a');
    const { target, OriginalWebSocket } = page(() => m.machine);
    const socket = new target.WebSocket('/ws/echo');
    expect(socket).toBeInstanceOf(ChannelWebSocket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('socket failed')), { once: true });
    });
    expect(socket.url).toBe('capacitor://localhost/ws/echo');
    const upgrade = m.seen.find((seen) => seen.method === 'UPGRADE')!;
    expect(upgrade.url).toBe('/ws/echo');
    expect(upgrade.headers.authorization).toBe('Bearer env-a-token');
    expect(upgrade.headers.origin).toBeUndefined();
    expect(OriginalWebSocket).not.toHaveBeenCalled();
    expect(target.WebSocket.OPEN).toBe(1);
  });

  it('fails a channel WebSocket with error then close 1006 when no machine is selected', async () => {
    const { target } = page(() => null);
    const socket = new target.WebSocket('ws://localhost/ws/rpc');
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      socket.addEventListener('error', () => events.push('error'));
      socket.addEventListener('close', (event) => {
        events.push(`close ${(event as CloseEvent).code}`);
        resolve();
      });
    });
    expect(events).toEqual(['error', 'close 1006']);
  });

  it('constructs the original WebSocket for the directory', () => {
    const m = machine('env-a');
    const { target, OriginalWebSocket } = page(() => m.machine);
    const socket = new target.WebSocket('wss://connect.overdeck.ai/v1/directory', ['p']);
    expect(OriginalWebSocket).toHaveBeenCalledWith('wss://connect.overdeck.ai/v1/directory', ['p']);
    expect((socket as unknown as { url: string }).url).toBe('wss://connect.overdeck.ai/v1/directory');
    expect(m.dial).not.toHaveBeenCalled();
  });

  it('restores the originals on uninstall and refuses a second install', () => {
    const originalFetch = vi.fn();
    const OriginalWebSocket = vi.fn();
    const target = { fetch: originalFetch, WebSocket: OriginalWebSocket } as unknown as ShimTarget;
    const uninstall = installChannelShims({ currentMachine: () => null, target, location: CAPACITOR });
    expect(target.fetch).not.toBe(originalFetch);
    expect(() => installChannelShims({ currentMachine: () => null, target, location: CAPACITOR })).toThrow(
      'Channel shims are already installed',
    );
    uninstall();
    expect(target.fetch).toBe(originalFetch);
    expect(target.WebSocket).toBe(OriginalWebSocket);
    uninstalls.push(installChannelShims({ currentMachine: () => null, target, location: CAPACITOR }));
  });
});
