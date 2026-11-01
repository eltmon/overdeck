/**
 * PAN-4645 WI-18: linkFetch stamps the actor and bearer headers and carries a
 * JSON request over a channel; the actor header helper is pure.
 */
import { createServer } from 'node:http';
import { duplexPair, type Duplex } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { LINK_ACTOR_HEADER, LINK_CEILING_HEADER } from '../link-actor.js';
import { _resetLinkClientForTests, LinkAgent, linkActorHeaders, linkFetch, type LinkRouteSource } from '../link-client.js';

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
