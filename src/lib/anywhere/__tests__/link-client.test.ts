/**
 * PAN-4645 WI-18: linkFetch stamps the actor and bearer headers and carries a
 * JSON request over a channel; the actor header helper is pure.
 */
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { duplexPair, type Duplex } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { LINK_ACTOR_HEADER, LINK_CEILING_HEADER } from '../link-actor.js';
import { _resetLinkClientForTests, isStaleChannelFailure, LINK_POOL_IDLE_MS, LinkAgent, linkActorHeaders, linkFetch, linkForward, type LinkRouteSource } from '../link-client.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  _resetLinkClientForTests();
});

/** A route source whose "channel" is one end of an in-process duplex pair served by a tiny HTTP server. */
function onlineSource(serverSide: Duplex): LinkRouteSource {
  return {
    routeFor: () => ({ state: 'online', url: 'tcp://127.0.0.1:1', machineKey: 'ab'.repeat(32), token: `odk_${'7'.repeat(64)}`, label: 'peer' }),
    waitOnline: async () => true,
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
  };
}

describe('link client (PAN-4645 WI-18)', () => {
  it('linkActorHeaders stamps operator or agent and an optional ceiling', () => {
    expect(linkActorHeaders()).toEqual({ [LINK_ACTOR_HEADER]: 'operator' });
    expect(linkActorHeaders({ agentId: 'pan-4645' }, ['read:state', 'tell'])).toEqual({ [LINK_ACTOR_HEADER]: 'agent:pan-4645', [LINK_CEILING_HEADER]: 'read:state,tell' });
    expect(linkActorHeaders('operator', [])).toEqual({ [LINK_ACTOR_HEADER]: 'operator' });
  });

  it('linkFetch sends the bearer token, the actor stamp and a JSON body over the agent\'s connection', async () => {
    const seen: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
      });
    });
    cleanups.push(() => server.close());
    const [clientSide, serverSide] = duplexPair();
    server.emit('connection', serverSide);
    // LinkAgent now carries a pool idle timeout (PAN-4740); the duplex pair isn't a net.Socket, unlike
    // the real ChannelSocket, which already implements setTimeout.
    (clientSide as unknown as { setTimeout: (ms: number, cb?: () => void) => Duplex }).setTimeout = () => clientSide;
    const source = onlineSource(serverSide);
    const agent = new LinkAgent('env-peer', { keepAlive: false }, source);
    // The agent's real connection would be a secure channel; here the duplex pair stands in for it.
    (agent as unknown as { createConnection: (o: unknown, cb: (e: null, s: Duplex) => void) => void }).createConnection = (_o, cb) => cb(null, clientSide);
    cleanups.push(() => agent.destroy());

    const result = await linkFetch('env-peer', '/api/conversations/x/stop', {
      method: 'POST', body: { reason: 'done' }, actor: { agentId: 'pan-1' }, ceiling: ['operate'], agent, routeSource: source,
    });
    expect(result).toEqual({ status: 200, json: { ok: true, echo: { reason: 'done' } } });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/conversations/x/stop', body: '{"reason":"done"}' });
    expect(seen[0]!.headers.authorization).toBe(`Bearer odk_${'7'.repeat(64)}`);
    expect(seen[0]!.headers[LINK_ACTOR_HEADER]).toBe('agent:pan-1');
    expect(seen[0]!.headers[LINK_CEILING_HEADER]).toBe('operate');
    expect(seen[0]!.headers['content-type']).toBe('application/json');
  });

  it('linkFetch fails fast for a revoked or missing link and without a route source', async () => {
    const revoked: LinkRouteSource = {
      routeFor: () => ({ state: 'revoked', url: null, machineKey: 'ab'.repeat(32), token: 'odk_x', label: 'peer' }),
      waitOnline: async () => false,
      localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    };
    await expect(linkFetch('env-peer', '/x', { routeSource: revoked })).rejects.toMatchObject({ code: 'machine-revoked' });
    await expect(linkFetch('env-none', '/x', { routeSource: { ...revoked, routeFor: () => null } })).rejects.toMatchObject({ code: 'no-link' });
    await expect(linkFetch('env-peer', '/x')).rejects.toMatchObject({ code: 'no-link' });
  });
});

/** A route source for the pooled-channel tests; the channel is a real loopback TCP socket, not a duplex pair. */
function poolSource(): LinkRouteSource {
  return {
    routeFor: () => ({ state: 'online', url: 'tcp://127.0.0.1:1', machineKey: 'ab'.repeat(32), token: `odk_${'7'.repeat(64)}`, label: 'peer' }),
    waitOnline: async () => true,
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
  };
}

/** A `LinkAgent` whose "channel" is a real loopback `net.Socket`, so pooling (`keepSocketAlive`) actually applies. */
function pooledAgent(port: number, source: LinkRouteSource): { agent: LinkAgent; connections: () => number } {
  let connections = 0;
  const agent = new LinkAgent('env-peer', {}, source);
  (agent as unknown as { createConnection: (o: unknown, cb: (e: null, s: Duplex) => void) => undefined }).createConnection = (_o, cb) => {
    connections += 1;
    const socket = net.connect(port);
    socket.once('connect', () => cb(null, socket as unknown as Duplex));
    return undefined;
  };
  return { agent, connections: () => connections };
}

describe('pooled channels (PAN-4740)', () => {
  let server: Server;
  let port: number;
  const agentCleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const cleanup of agentCleanups.splice(0)) cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function listen(keepAliveTimeout: number): Promise<void> {
    server = createServer((_req, res) => res.end('ok'));
    server.keepAliveTimeout = keepAliveTimeout;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as net.AddressInfo).port;
  }

  it('a pooled channel carries LINK_POOL_IDLE_MS as its idle timeout', async () => {
    await listen(60_000);
    const source = poolSource();
    const { agent } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await linkFetch('env-peer', '/x', { agent, routeSource: source });
    await new Promise((resolve) => setImmediate(resolve));

    const free = Object.values(agent.freeSockets).flat();
    expect(free).toHaveLength(1);
    expect(free[0]!.timeout).toBe(LINK_POOL_IDLE_MS);
  });

  it('a shorter keep-alive hint from the peer lowers the idle timeout', async () => {
    await listen(3_000);
    const source = poolSource();
    const { agent } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await linkFetch('env-peer', '/x', { agent, routeSource: source });
    await new Promise((resolve) => setImmediate(resolve));

    const free = Object.values(agent.freeSockets).flat();
    expect(free).toHaveLength(1);
    expect(free[0]!.timeout).toBe(2_000);
  });

  it('an idle timeout on a free channel closes it and the next request opens a new one', async () => {
    await listen(60_000);
    const source = poolSource();
    const { agent, connections } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await linkFetch('env-peer', '/x', { agent, routeSource: source });
    await new Promise((resolve) => setImmediate(resolve));
    const free = Object.values(agent.freeSockets).flat();
    expect(free).toHaveLength(1);

    free[0]!.emit('timeout');
    expect(free[0]!.destroyed).toBe(true);

    const result = await linkFetch('env-peer', '/x', { agent, routeSource: source });
    expect(result.status).toBe(200);
    expect(connections()).toBe(2);
  });
});

describe('stale channel retry (PAN-4740)', () => {
  let server: Server;
  const agentCleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const cleanup of agentCleanups.splice(0)) cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Destroys the raw socket on the `destroyOnRequest`-th request it sees, without answering. */
  async function startDestroyingServer(destroyOnRequest: number): Promise<{ port: number; seen: () => number }> {
    let count = 0;
    server = createServer((req, res) => {
      count += 1;
      if (count === destroyOnRequest) {
        req.socket.destroy();
        return;
      }
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as net.AddressInfo).port, seen: () => count };
  }

  it('linkFetch resends a GET once when a reused channel hangs up', async () => {
    const { port, seen } = await startDestroyingServer(2);
    const source = poolSource();
    const { agent, connections } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await expect(linkFetch('env-peer', '/x', { agent, routeSource: source })).resolves.toMatchObject({ status: 200 });
    await expect(linkFetch('env-peer', '/x', { agent, routeSource: source })).resolves.toMatchObject({ status: 200 });

    expect(seen()).toBe(3);
    expect(connections()).toBe(2);
  });

  it('linkFetch never resends a POST', async () => {
    const { port, seen } = await startDestroyingServer(2);
    const source = poolSource();
    const { agent } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await expect(linkFetch('env-peer', '/x', { agent, routeSource: source })).resolves.toMatchObject({ status: 200 });
    await expect(linkFetch('env-peer', '/x', { method: 'POST', agent, routeSource: source })).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(seen()).toBe(2);
  });

  it('a hang-up on a fresh channel is not retried', async () => {
    const { port, seen } = await startDestroyingServer(1);
    const source = poolSource();
    const { agent } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await expect(linkFetch('env-peer', '/x', { agent, routeSource: source })).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(seen()).toBe(1);
  });

  it('linkForward resends a GET once when a reused channel hangs up', async () => {
    const { port, seen } = await startDestroyingServer(2);
    const source = poolSource();
    const { agent } = pooledAgent(port, source);
    agentCleanups.push(() => agent.destroy());

    await expect(linkFetch('env-peer', '/x', { agent, routeSource: source })).resolves.toMatchObject({ status: 200 });
    const result = await linkForward('env-peer', { method: 'GET', path: '/x', agent, routeSource: source });

    expect(result.status).toBe(200);
    expect(seen()).toBe(3);
  });

  it('isStaleChannelFailure accepts only a safe method on a reused channel before a response', () => {
    const econnreset = Object.assign(new Error('x'), { code: 'ECONNRESET' });
    const epipe = Object.assign(new Error('x'), { code: 'EPIPE' });
    const etimedout = Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
    expect(isStaleChannelFailure('GET', econnreset, { reusedSocket: true, responded: false })).toBe(true);
    expect(isStaleChannelFailure('POST', econnreset, { reusedSocket: true, responded: false })).toBe(false);
    expect(isStaleChannelFailure('GET', econnreset, { reusedSocket: false, responded: false })).toBe(false);
    expect(isStaleChannelFailure('GET', econnreset, { reusedSocket: true, responded: true })).toBe(false);
    expect(isStaleChannelFailure('GET', etimedout, { reusedSocket: true, responded: false })).toBe(false);
    expect(isStaleChannelFailure('head', epipe, { reusedSocket: true, responded: false })).toBe(true);
  });
});
