/** PAN-4834 WI-2: one request on a channel, and the phone's keep-alive channel pool. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type Duplex, duplexPair } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ChannelPool, ChannelHttpError, createChannelPool } from '../http-client.js';

const decoder = new TextDecoder();
const text = (bytes: Uint8Array): string => decoder.decode(bytes);

const open: Duplex[] = [];
const pools: ChannelPool[] = [];

/** One `duplexPair()` whose ends destroy each other, as a real channel would. */
function linkedPair(): [client: Duplex, peer: Duplex] {
  const [a, b] = duplexPair();
  a.once('close', () => b.destroy());
  b.once('close', () => a.destroy());
  open.push(a, b);
  return [a, b];
}

function track(pool: ChannelPool): ChannelPool {
  pools.push(pool);
  return pool;
}

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  for (const stream of open.splice(0)) stream.destroy();
});

/** Lets stream callbacks (nextTick and setImmediate, which stay real) run. */
async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('channel pool against a real Node HTTP server', () => {
  let server: Server;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const clients: Duplex[] = [];

  beforeEach(() => {
    handler = (_req, res) => res.end('ok');
    server = createServer((req, res) => handler(req, res));
    clients.length = 0;
  });

  afterEach(() => {
    server.close();
  });

  const dial = vi.fn(async () => {
    const [client, serverEnd] = linkedPair();
    server.emit('connection', serverEnd);
    clients.push(client);
    return client;
  });

  beforeEach(() => dial.mockClear());

  it('runs three sequential GETs on one channel', async () => {
    const pool = track(createChannelPool({ dial }));
    for (let i = 0; i < 3; i++) {
      const response = await pool.request({ method: 'GET', path: `/api/n/${i}` });
      expect(response.status).toBe(200);
      expect(text(response.body)).toBe('ok');
    }
    expect(dial).toHaveBeenCalledTimes(1);
    expect(pool.size).toBe(1);
    expect(pool.idleCount).toBe(1);
  });

  it('serves five concurrent GETs on four channels', async () => {
    handler = (req, res) => res.end(req.url);
    const pool = track(createChannelPool({ dial }));
    const responses = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => pool.request({ method: 'GET', path: `/api/c/${i}` })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(responses.map((response) => text(response.body))).toEqual([0, 1, 2, 3, 4].map((i) => `/api/c/${i}`));
    expect(dial).toHaveBeenCalledTimes(4);
    expect(pool.size).toBe(4);
  });

  it('delivers a POST body intact with the channel headers', async () => {
    let seen: { body: string; headers: IncomingMessage['headers'] } | null = null;
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        seen = { body: Buffer.concat(chunks).toString('utf8'), headers: req.headers };
        res.statusCode = 201;
        res.end();
      });
    };
    const pool = track(createChannelPool({ dial }));
    const body = new TextEncoder().encode('{"hello":"wörld"}');
    const response = await pool.request({
      method: 'POST',
      path: '/api/up',
      headers: { 'content-type': 'application/json', origin: 'capacitor://localhost' },
      body,
    });
    expect(response.status).toBe(201);
    expect(seen).not.toBeNull();
    expect(seen!.body).toBe('{"hello":"wörld"}');
    expect(seen!.headers.host).toBe('link.invalid');
    expect(seen!.headers.origin).toBeUndefined();
    expect(seen!.headers['content-length']).toBe(String(body.byteLength));
  });

  it('answers HEAD with an empty body and reuses the channel', async () => {
    handler = (_req, res) => {
      res.setHeader('content-length', '10');
      res.end();
    };
    const pool = track(createChannelPool({ dial }));
    const head = await pool.request({ method: 'HEAD', path: '/api/h' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    handler = (_req, res) => res.end('after');
    const next = await pool.request({ method: 'GET', path: '/api/after' });
    expect(text(next.body)).toBe('after');
    expect(dial).toHaveBeenCalledTimes(1);
  });
});

describe('channel pool against scripted channels', () => {
  type Reply = (peer: Duplex, request: string) => void;

  /** Each dial gets the next script; a script answers every request on its channel. */
  function scriptedDial(...scripts: Reply[]) {
    const peers: Duplex[] = [];
    const clientEnds: Duplex[] = [];
    const dial = vi.fn(async () => {
      const script = scripts[clientEnds.length];
      if (!script) throw new Error('no more scripted channels');
      const [client, peer] = linkedPair();
      peer.on('data', (chunk: Buffer) => script(peer, chunk.toString('latin1')));
      peers.push(peer);
      clientEnds.push(client);
      return client;
    });
    return { dial, peers, clientEnds };
  }

  const ok = (extra = ''): string => `HTTP/1.1 200 OK\r\nContent-Length: 2\r\n${extra}\r\nok`;
  const replyOk: Reply = (peer) => peer.write(ok());
  const silent: Reply = () => {};

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes an idle channel at 4000 ms and not at 3999 ms', async () => {
    const { dial, clientEnds } = scriptedDial(replyOk);
    const pool = track(createChannelPool({ dial }));
    await pool.request({ method: 'GET', path: '/api/a' });
    await vi.advanceTimersByTimeAsync(3999);
    expect(clientEnds[0].destroyed).toBe(false);
    expect(pool.idleCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(clientEnds[0].destroyed).toBe(true);
    expect(pool.size).toBe(0);
  });

  it('idles out after 1000 ms when the response says Keep-Alive: timeout=2', async () => {
    const { dial, clientEnds } = scriptedDial((peer) => peer.write(ok('Keep-Alive: timeout=2\r\n')));
    const pool = track(createChannelPool({ dial }));
    await pool.request({ method: 'GET', path: '/api/a' });
    await vi.advanceTimersByTimeAsync(999);
    expect(clientEnds[0].destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(clientEnds[0].destroyed).toBe(true);
  });

  /** Answers the first request, then closes the channel when the second arrives (the server's idle close). */
  function staleAfterFirst(): Reply {
    let served = 0;
    return (peer) => {
      served += 1;
      if (served === 1) peer.write(ok());
      else peer.destroy();
    };
  }

  it('resends a GET once on a fresh channel when a reused channel was stale', async () => {
    const { dial, peers } = scriptedDial(staleAfterFirst(), replyOk);
    const pool = track(createChannelPool({ dial }));
    await pool.request({ method: 'GET', path: '/api/a' });
    const response = await pool.request({ method: 'GET', path: '/api/b' });
    expect(response.status).toBe(200);
    expect(dial).toHaveBeenCalledTimes(2);
    expect(peers[0].destroyed).toBe(true);
    expect(pool.size).toBe(1);
  });

  it('does not resend a POST on a stale channel', async () => {
    const { dial } = scriptedDial(staleAfterFirst(), replyOk);
    const pool = track(createChannelPool({ dial }));
    await pool.request({ method: 'GET', path: '/api/a' });
    const failure = await pool.request({ method: 'POST', path: '/api/b' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChannelHttpError);
    expect((failure as ChannelHttpError).code).toBe('channel-closed');
    expect((failure as ChannelHttpError).responded).toBe(false);
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it('does not resend a GET that failed on a freshly dialled channel', async () => {
    const { dial } = scriptedDial((peer) => peer.destroy(), replyOk);
    const pool = track(createChannelPool({ dial }));
    const failure = await pool.request({ method: 'GET', path: '/api/a' }).catch((error: unknown) => error);
    expect((failure as ChannelHttpError).code).toBe('channel-closed');
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it('destroys a channel whose response says Connection: close', async () => {
    const { dial, clientEnds } = scriptedDial((peer) => peer.write(ok('Connection: close\r\n')));
    const pool = track(createChannelPool({ dial }));
    const response = await pool.request({ method: 'GET', path: '/api/a' });
    expect(text(response.body)).toBe('ok');
    expect(clientEnds[0].destroyed).toBe(true);
    expect(pool.size).toBe(0);
  });

  it('destroys the channel and rejects AbortError when an in-flight request is aborted', async () => {
    const { dial, clientEnds } = scriptedDial(silent);
    const pool = track(createChannelPool({ dial }));
    const controller = new AbortController();
    const pending = pool.request({ method: 'GET', path: '/api/slow' }, { signal: controller.signal });
    await settle();
    controller.abort();
    const failure = await pending.catch((error: unknown) => error);
    expect((failure as DOMException).name).toBe('AbortError');
    expect(clientEnds[0].destroyed).toBe(true);
    expect(pool.size).toBe(0);
  });

  it('hands the slot an aborted in-flight request frees to the queued request', async () => {
    const { dial, clientEnds } = scriptedDial(silent, replyOk);
    const pool = track(createChannelPool({ dial, max: 1 }));
    const controller = new AbortController();
    const first = pool.request({ method: 'GET', path: '/api/slow' }, { signal: controller.signal });
    const queued = pool.request({ method: 'GET', path: '/api/next' });
    await settle();
    expect(dial).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(((await first.catch((error: unknown) => error)) as DOMException).name).toBe('AbortError');
    expect(clientEnds[0].destroyed).toBe(true);
    const response = await queued;
    expect(response.status).toBe(200);
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it('removes an aborted request from the queue', async () => {
    const requests: string[] = [];
    const { dial } = scriptedDial((peer, request) => {
      requests.push(request.split(' ')[1]);
      if (requests.length === 1) setImmediate(() => peer.write(ok()));
      else peer.write(ok());
    });
    const pool = track(createChannelPool({ dial, max: 1 }));
    const first = pool.request({ method: 'GET', path: '/api/first' });
    const controller = new AbortController();
    const queued = pool.request({ method: 'GET', path: '/api/queued' }, { signal: controller.signal });
    const third = pool.request({ method: 'GET', path: '/api/third' });
    controller.abort();
    const failure = await queued.catch((error: unknown) => error);
    expect((failure as DOMException).name).toBe('AbortError');
    await first;
    await third;
    expect(requests).toEqual(['/api/first', '/api/third']);
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it('rejects queued and later requests with pool-closed after close()', async () => {
    const { dial } = scriptedDial(silent);
    const pool = track(createChannelPool({ dial, max: 1 }));
    const inFlight = pool.request({ method: 'GET', path: '/api/a' }).catch((error: unknown) => error);
    const queued = pool.request({ method: 'GET', path: '/api/b' }).catch((error: unknown) => error);
    await settle();
    pool.close();
    expect(((await queued) as ChannelHttpError).code).toBe('pool-closed');
    expect(((await inFlight) as ChannelHttpError).code).toBe('pool-closed');
    const later = await pool.request({ method: 'GET', path: '/api/c' }).catch((error: unknown) => error);
    expect((later as ChannelHttpError).code).toBe('pool-closed');
    expect(pool.size).toBe(0);
  });

  it('rejects only the request whose dial failed with dial-failed', async () => {
    let attempts = 0;
    const [client, peer] = linkedPair();
    peer.on('data', () => peer.write(ok()));
    const dial = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('relay unreachable');
      return client;
    });
    const pool = track(createChannelPool({ dial }));
    const failure = await pool.request({ method: 'GET', path: '/api/a' }).catch((error: unknown) => error);
    expect((failure as ChannelHttpError).code).toBe('dial-failed');
    expect((failure as ChannelHttpError).cause).toBeInstanceOf(Error);
    const response = await pool.request({ method: 'GET', path: '/api/b' });
    expect(response.status).toBe(200);
    expect(pool.size).toBe(1);
  });
});
