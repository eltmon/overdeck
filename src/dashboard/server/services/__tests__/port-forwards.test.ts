/**
 * PAN-4650 WI-18: a forward relays HTTP end to end through the owner's
 * /ws/forward, binds 127.0.0.1 only, opens nothing for a refused port, and
 * closes after 30 idle minutes or when its link goes away.
 */
import { createServer as createHttpServer, get, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../../lib/access-tokens.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { ChannelMarker } from '../../channel-peer.js';
import { setupForwardWebSocket } from '../../ws-forward.js';
import {
  _resetForwardsForTests,
  FORWARD_IDLE_MS,
  ForwardRefusedError,
  listForwards,
  startForward,
  stopForwardsWithoutLink,
  type PortForwardDeps,
} from '../port-forwards.js';

const LINK_MARKER: ChannelMarker = { mode: 'link', remoteKeyHex: 'ab'.repeat(32), pairingId: null };
const link: MachineLink = {
  id: 'link-desk', environmentId: 'env-desk', label: 'desk', machineKey: 'ab'.repeat(32), token: `odk_${'5'.repeat(64)}`, access: 'operator',
  reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
};
const closers: Array<() => Promise<void>> = [];

function listen(server: Server): Promise<number> {
  closers.push(() => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

/** The owner: a dev server and the /ws/forward endpoint that reaches it. */
async function ownerWithDevServer(): Promise<{ deps: Partial<PortForwardDeps>; devPort: number }> {
  const dev = createHttpServer((_request, response) => response.end('hello from desk'));
  const devPort = await listen(dev);
  const owner = createHttpServer();
  setupForwardWebSocket(owner, {
    channelOf: () => LINK_MARKER,
    authorize: () => ({ ok: true, credential: { kind: 'machine', tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor: 'operator', access: 'operator' } }),
    refusedPorts: async () => new Set([3011]),
  });
  const ownerPort = await listen(owner);
  return { devPort, deps: { getLink: async () => link, openSocket: async () => connect(ownerPort, '127.0.0.1') } };
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

afterEach(async () => {
  vi.useRealTimers();
  _resetForwardsForTests();
  for (const close of closers.splice(0).reverse()) await close();
});

describe('port forwards (PAN-4650 WI-18)', () => {
  it('relays an HTTP GET end to end and listens on 127.0.0.1 only', async () => {
    const { deps, devPort } = await ownerWithDevServer();
    const forward = await startForward('desk', devPort, deps);
    expect(forward.url).toBe(`http://127.0.0.1:${forward.localPort}`);
    expect(forward).toMatchObject({ label: 'desk', port: devPort, environmentId: 'env-desk' });
    expect(await fetchText(forward.url)).toBe('hello from desk');
    expect(listForwards().map((f) => f.id)).toEqual([forward.id]);
  });

  it('a refused port answers 403 port-refused and opens no listener', async () => {
    const { deps } = await ownerWithDevServer();
    const refusal = startForward('desk', 3011, deps);
    await expect(refusal).rejects.toBeInstanceOf(ForwardRefusedError);
    await expect(refusal).rejects.toMatchObject({ status: 403, code: 'port-refused' });
    expect(listForwards()).toEqual([]);
  });

  it('closes after 30 minutes without an open connection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { deps, devPort } = await ownerWithDevServer();
    await startForward('desk', devPort, deps);
    await vi.advanceTimersByTimeAsync(FORWARD_IDLE_MS - 1);
    expect(listForwards()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(listForwards()).toEqual([]);
  });

  it('closes when its link goes away', async () => {
    const { deps, devPort } = await ownerWithDevServer();
    await startForward('desk', devPort, deps);
    stopForwardsWithoutLink(['env-desk']);
    expect(listForwards()).toHaveLength(1);
    stopForwardsWithoutLink([]);
    expect(listForwards()).toEqual([]);
  });
});
