/**
 * PAN-4645 WI-19: the supervisor learns routes from the peer's advertised
 * endpoints (on connect and on an endpoints-hash change), persists them, drops
 * advertised routes the peer no longer lists, and moves to a better route at
 * the 60 s re-check. Fake timers; a fake channel opener with per-URL
 * reachability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelOpenError } from '../../../../lib/anywhere/channel/open.js';
import type { ChannelSocket } from '../../../../lib/anywhere/channel/channel-socket.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import type { HeartbeatHandlers } from '../link-heartbeat.js';
import { BETTER_ROUTE_INTERVAL_MS, LinkSupervisor, type LinkSupervisorDeps, PROBE_TIMEOUT_MS } from '../link-supervisor.js';

const PEER_KEY = 'b2'.repeat(32);
const TAILNET = 'tcp://100.101.1.2:3011';
const LAN = 'tcp://192.168.1.5:3011';
const PAIRING: LinkRoute = { url: TAILNET, kind: 'tailnet', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' };

function link(routes: LinkRoute[]): MachineLink {
  return {
    id: 'link-1', environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes, createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
  };
}

class FakeChannel {
  destroyed = false;
  readonly channel = { mode: 'link' as const, remoteKeyHex: PEER_KEY, pairingId: null };
  constructor(readonly url: string) {}
  destroy(): void { this.destroyed = true; }
}

interface Harness {
  supervisor: LinkSupervisor;
  deps: LinkSupervisorDeps;
  reachable: Set<string>;
  channels: FakeChannel[];
  persisted: LinkRoute[][];
  peer: { endpoints: Array<{ kind: 'lan' | 'tailnet'; url: string }> } & Record<string, unknown>;
  /** The endpoints hash the fake peer sends in every heartbeat. */
  hash: string;
  /** Send a heartbeat now (the fake peer also sends one every 15 s). */
  beat(): void;
}

function harness(routes: LinkRoute[], endpoints: Array<{ kind: 'lan' | 'tailnet'; url: string }>, reachable: string[]): Harness {
  const channels: FakeChannel[] = [];
  const persisted: LinkRoute[][] = [];
  const heartbeats: HeartbeatHandlers[] = [];
  const reach = new Set(reachable);
  let seq = 0;
  const state = { hash: 'aaaa' };
  const payload = () => ({ seq: ++seq, lastStall: null, endpointsHash: state.hash, serverVersion: '0.73.0' });
  const peer: Harness['peer'] = {
    descriptorVersion: 1, environmentId: 'env-peer', label: 'peer', platform: { os: 'linux', arch: 'x64' }, serverVersion: '0.73.0',
    protocolVersion: 1, capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true },
    machineKey: PEER_KEY, linkProtocol: 1, endpoints,
  };
  const deps: LinkSupervisorDeps = {
    linksSnapshot: () => [link(routes)],
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    openChannel: vi.fn(async (url, opts) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, reach.has(url) ? 10 : PROBE_TIMEOUT_MS);
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new ChannelOpenError('aborted', 'aborted')); }, { once: true });
      });
      if (!reach.has(url)) throw new ChannelOpenError('unreachable', `${url}: ECONNREFUSED`);
      const channel = new FakeChannel(url);
      channels.push(channel);
      return channel as unknown as ChannelSocket;
    }),
    channelRequest: vi.fn(async () => ({ status: 200, json: peer })),
    openHeartbeat: vi.fn(async (_channel, _token, handlers) => {
      heartbeats.push(handlers);
      handlers.onHeartbeat(payload());
      const timer = setInterval(() => handlers.onHeartbeat(payload()), 15_000);
      return { close: () => clearInterval(timer) };
    }),
    markLinkRevoked: vi.fn(async () => null),
    setLinkRoutes: vi.fn(async (_id: string, next: LinkRoute[]) => { persisted.push(next); return null; }),
    serverVersion: '0.73.0',
    now: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
  };
  const supervisor = new LinkSupervisor(deps);
  return {
    supervisor, deps, reachable: reach, channels, persisted, peer,
    get hash() { return state.hash; },
    set hash(next: string) { state.hash = next; },
    beat: () => heartbeats.at(-1)!.onHeartbeat(payload()),
  };
}

let h: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
});

afterEach(() => {
  h?.supervisor.stop();
  vi.useRealTimers();
});

const live = (channels: FakeChannel[]) => channels.filter((channel) => !channel.destroyed);

describe('link supervisor routes (PAN-4645 WI-19)', () => {
  it('ac3: a link with only a tailnet route learns the advertised lan route and switches to it within one 60 s re-check', async () => {
    h = harness([PAIRING], [{ kind: 'lan', url: LAN }], [TAILNET, LAN]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: TAILNET });
    expect(h.persisted.at(-1)).toEqual([PAIRING, expect.objectContaining({ url: LAN, kind: 'lan', source: 'advertised' })]);
    expect(h.supervisor.status('link-1').routeStatus(LAN)).toBe('untried');

    await vi.advanceTimersByTimeAsync(BETTER_ROUTE_INTERVAL_MS + 50);
    const status = h.supervisor.status('link-1');
    expect(status).toMatchObject({ state: 'online', currentRoute: LAN });
    expect(status.routeStatus(LAN)).toBe('current');
    expect(live(h.channels).map((channel) => channel.url)).toEqual([LAN]);
    expect(h.supervisor.routeFor('env-peer')).toMatchObject({ url: LAN });
  });

  it('stays on the pairing route when the advertised lan route does not answer, and tries again a minute later', async () => {
    h = harness([PAIRING], [{ kind: 'lan', url: LAN }], [TAILNET]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(BETTER_ROUTE_INTERVAL_MS + PROBE_TIMEOUT_MS + 100);
    expect(h.supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: TAILNET });
    expect(h.supervisor.status('link-1').routeStatus(LAN)).toBe('unreachable');
    const lanProbes = () => (h.deps.openChannel as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === LAN).length;
    expect(lanProbes()).toBe(1); // the lan route was learned after connecting, so only the 60 s check tried it
    await vi.advanceTimersByTimeAsync(BETTER_ROUTE_INTERVAL_MS);
    expect(lanProbes()).toBe(2);
    expect(live(h.channels).map((channel) => channel.url)).toEqual([TAILNET]);
  });

  it('ac4: an advertised route the peer no longer lists is dropped while the pairing route stays', async () => {
    const stale: LinkRoute = { url: LAN, kind: 'lan', source: 'advertised', addedAt: '2026-11-01T00:00:00.000Z' };
    h = harness([PAIRING, stale], [], [TAILNET]);
    h.supervisor.start();
    // The stale lan route ranks first, so the connect waits for its probe to fail before taking the tailnet route.
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 50);
    expect(h.supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: TAILNET });
    expect(h.persisted).toEqual([[PAIRING]]);
    const lanProbes = () => (h.deps.openChannel as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => url === LAN).length;
    expect(lanProbes()).toBe(1);
    await vi.advanceTimersByTimeAsync(BETTER_ROUTE_INTERVAL_MS * 2);
    expect(lanProbes()).toBe(1); // dropped: no better-route check ever tries it again
    expect(h.supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: TAILNET });
  });

  it('a changed endpoints hash in the heartbeat refetches the descriptor and merges the new route', async () => {
    h = harness([PAIRING], [], [TAILNET, LAN]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.persisted).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000); // a same-hash heartbeat refetches nothing
    const reads = (h.deps.channelRequest as ReturnType<typeof vi.fn>).mock.calls.length;
    h.peer.endpoints = [{ kind: 'lan', url: LAN }];
    h.hash = 'bbbb';
    h.beat();
    await vi.advanceTimersByTimeAsync(10);
    expect((h.deps.channelRequest as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads + 1);
    expect(h.persisted.at(-1)).toEqual([PAIRING, expect.objectContaining({ url: LAN, source: 'advertised' })]);
    await vi.advanceTimersByTimeAsync(BETTER_ROUTE_INTERVAL_MS + 50);
    expect(h.supervisor.status('link-1').currentRoute).toBe(LAN);
  });

  it('a route that closes before proving its key counts as unreachable while another route refuses outright', async () => {
    h = harness([PAIRING, { url: LAN, kind: 'lan', source: 'advertised', addedAt: '2026-11-01T00:00:00.000Z' }], [], []);
    (h.deps.openChannel as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (url === TAILNET) throw new ChannelOpenError('identity-refused', 'Responder closed the connection before proving the pinned machine key');
      throw new ChannelOpenError('unreachable', `${url}: ECONNREFUSED`);
    });
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    const status = h.supervisor.status('link-1');
    expect(status.state).toBe('offline');
    expect(status.stateDetail).toContain('ECONNREFUSED');
    expect(status.stateDetail).not.toContain('another machine key');
    // Both routes closing silently is the key-mismatch case.
    (h.deps.openChannel as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new ChannelOpenError('identity-refused', 'closed');
    });
    expect(h.supervisor.reconnect('link-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.supervisor.status('link-1').stateDetail).toContain('closed the connection before proving the pinned machine key');
  });

  it('updateRoutes (Add route) re-ranks and probes the new route at once', async () => {
    h = harness([PAIRING], [], [TAILNET, LAN]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    const manual: LinkRoute = { url: LAN, kind: 'lan', source: 'manual', addedAt: '2026-11-01T12:00:00.000Z' };
    h.supervisor.updateRoutes('link-1', [PAIRING, manual]);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: LAN });
  });
});
