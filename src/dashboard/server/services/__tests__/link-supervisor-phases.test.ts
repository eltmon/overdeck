/**
 * PAN-2356 WI-12 (D-2356-7, D-2356-8): the supervisor merges the directory's dynamic routes with
 * the stored ones and probes in phases — stored kinds at 2.5 s, then `direct`, then `relay` — and
 * reports NO_DIRECT_PATH_MESSAGE when the plan has no relay. Fake timers; a fake channel opener
 * with per-URL reachability that records every dial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_DIRECT_PATH_MESSAGE, type DirectoryMachine } from '@overdeck/contracts';

import { ChannelOpenError } from '../../../../lib/anywhere/channel/open.js';
import type { ChannelSocket } from '../../../../lib/anywhere/channel/channel-socket.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import { directoryRoutesFor } from '../directory-routes.js';
import {
  DIRECT_PROBE_TIMEOUT_MS,
  LinkSupervisor,
  type LinkSupervisorDeps,
  PROBE_TIMEOUT_MS,
  RELAY_PROBE_TIMEOUT_MS,
} from '../link-supervisor.js';
import { machineLinkView } from '../machine-link-service.js';

const ENV = '0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234';
const PEER_KEY = 'b2'.repeat(32);
const TCP = 'tcp://100.101.1.2:3011';
const DIRECT = `rtc://${ENV}`;
const RELAY = `rtc+turn://${ENV}`;
const AT = '2026-11-01T00:00:00.000Z';
const STORED: LinkRoute = { url: TCP, kind: 'tailnet', source: 'pairing', addedAt: AT };

function link(): MachineLink {
  return {
    id: 'link-1', environmentId: ENV, label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes: [STORED], createdAt: AT, revokedAt: null,
  };
}

class FakeChannel {
  destroyed = false;
  readonly channel = { mode: 'link' as const, remoteKeyHex: PEER_KEY, pairingId: null };
  constructor(readonly url: string) {}
  destroy(): void { this.destroyed = true; }
}

function harness(options: { reachable: string[]; relay: boolean }) {
  const dialed: Array<{ url: string; at: number; timeoutMs: number | undefined }> = [];
  const persisted: LinkRoute[][] = [];
  const reach = new Set(options.reachable);
  const start = Date.now();
  const peer = {
    descriptorVersion: 1, environmentId: ENV, label: 'peer', platform: { os: 'linux', arch: 'x64' }, serverVersion: '0.73.0',
    protocolVersion: 1, capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true },
    machineKey: PEER_KEY, linkProtocol: 1, endpoints: [{ kind: 'lan', url: 'tcp://192.168.1.5:3011' }],
  };
  const dynamic: LinkRoute[] = [
    { url: DIRECT, kind: 'direct', source: 'directory', addedAt: AT },
    ...(options.relay ? [{ url: RELAY, kind: 'relay' as const, source: 'directory' as const, addedAt: AT }] : []),
  ];
  const deps: LinkSupervisorDeps = {
    linksSnapshot: () => [link()],
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    openChannel: vi.fn(async (url, opts) => {
      dialed.push({ url, at: Date.now() - start, timeoutMs: opts.timeoutMs });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, reach.has(url) ? 10 : opts.timeoutMs ?? PROBE_TIMEOUT_MS);
        opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new ChannelOpenError('aborted', 'aborted')); }, { once: true });
      });
      if (!reach.has(url)) throw new ChannelOpenError('unreachable', `${url}: no answer`);
      return new FakeChannel(url) as unknown as ChannelSocket;
    }),
    channelRequest: vi.fn(async () => ({ status: 200, json: peer })),
    openHeartbeat: vi.fn(async (_channel, _token, handlers) => {
      handlers.onHeartbeat({ seq: 1, lastStall: null, endpointsHash: 'h', serverVersion: '0.73.0' });
      const timer = setInterval(() => handlers.onHeartbeat({ seq: 2, lastStall: null, endpointsHash: 'h', serverVersion: '0.73.0' }), 15_000);
      return { close: () => clearInterval(timer) };
    }),
    markLinkRevoked: vi.fn(async () => null),
    setLinkRoutes: vi.fn(async (_id: string, next: LinkRoute[]) => { persisted.push(next); return null; }),
    serverVersion: '0.73.0',
    now: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
    dynamicRoutes: () => dynamic,
    relayEntitled: () => options.relay,
  };
  return { supervisor: new LinkSupervisor(deps), dialed, persisted };
}

let supervisor: LinkSupervisor | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
});

afterEach(() => {
  supervisor?.stop();
  supervisor = null;
  vi.useRealTimers();
});

describe('phased probing with directory routes (PAN-2356 WI-12)', () => {
  it('dials only the stored tcp route when it answers', async () => {
    const h = harness({ reachable: [TCP, DIRECT, RELAY], relay: true });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: TCP });
    expect(h.dialed.map((d) => d.url)).toEqual([TCP]);
  });

  it('dials direct after phase 1 fails, with the 10 s timeout, and makes it current', async () => {
    const h = harness({ reachable: [DIRECT], relay: true });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 50);
    expect(h.dialed.map((d) => d.url)).toEqual([TCP, DIRECT]);
    expect(h.dialed[1]).toMatchObject({ at: PROBE_TIMEOUT_MS, timeoutMs: DIRECT_PROBE_TIMEOUT_MS });
    expect(supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: DIRECT });
  });

  it('dials relay last when tcp and direct both fail and the plan has the relay', async () => {
    const h = harness({ reachable: [RELAY], relay: true });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + DIRECT_PROBE_TIMEOUT_MS + 50);
    expect(h.dialed.map((d) => d.url)).toEqual([TCP, DIRECT, RELAY]);
    expect(h.dialed[2]).toMatchObject({ at: PROBE_TIMEOUT_MS + DIRECT_PROBE_TIMEOUT_MS, timeoutMs: RELAY_PROBE_TIMEOUT_MS });
    expect(supervisor.status('link-1')).toMatchObject({ state: 'online', currentRoute: RELAY });
  });

  it('reports NO_DIRECT_PATH_MESSAGE when phases 1 and 2 fail and the plan has no relay', async () => {
    const h = harness({ reachable: [], relay: false });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + DIRECT_PROBE_TIMEOUT_MS + 50);
    expect(h.dialed.map((d) => d.url)).toEqual([TCP, DIRECT]);
    expect(supervisor.status('link-1')).toMatchObject({ state: 'offline', stateDetail: NO_DIRECT_PATH_MESSAGE });
  });

  it('never persists a directory route, and lists them in the Machines view', async () => {
    const h = harness({ reachable: [DIRECT], relay: true });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 50);
    expect(h.persisted.length).toBeGreaterThan(0);
    for (const routes of h.persisted) expect(routes.some((route) => route.url.startsWith('rtc'))).toBe(false);
    const view = machineLinkView(link(), null, supervisor);
    expect(view.routes.map((route) => [route.url, route.source, route.status])).toEqual([
      [TCP, 'pairing', 'unreachable'],
      [DIRECT, 'directory', 'current'],
      [RELAY, 'directory', 'untried'],
    ]);
  });
});

describe('directoryRoutesFor (D-2356-7)', () => {
  const machine = (over: Partial<DirectoryMachine> = {}): DirectoryMachine => ({
    environmentId: ENV, label: 'peer', publicKeyHex: PEER_KEY, fingerprint: '', online: true, lastSeenAt: AT, serverVersion: '0.73.0',
    endpoints: [{ kind: 'lan', url: 'tcp://192.168.1.5:3011' }], ...over,
  });
  const directory = (m: DirectoryMachine | null, relay = true) => ({ isOnline: () => true, relayEntitled: () => relay, machine: () => m });

  it('offers the reported address, direct and, with the relay plan, relay', () => {
    expect(directoryRoutesFor(link(), directory(machine())).map((r) => [r.url, r.kind, r.source])).toEqual([
      ['tcp://192.168.1.5:3011', 'lan', 'directory'],
      [DIRECT, 'direct', 'directory'],
      [RELAY, 'relay', 'directory'],
    ]);
    expect(directoryRoutesFor(link(), directory(machine(), false)).map((r) => r.kind)).toEqual(['lan', 'direct']);
  });

  it('offers nothing when the directory key differs from the pinned key', () => {
    expect(directoryRoutesFor(link(), directory(machine({ publicKeyHex: 'c3'.repeat(32) })))).toEqual([]);
  });

  it('offers nothing for an offline peer, an unlisted peer or an offline directory', () => {
    expect(directoryRoutesFor(link(), directory(machine({ online: false })))).toEqual([]);
    expect(directoryRoutesFor(link(), directory(null))).toEqual([]);
    expect(directoryRoutesFor(link(), { isOnline: () => false, relayEntitled: () => true, machine: () => machine() })).toEqual([]);
    expect(directoryRoutesFor(link(), null)).toEqual([]);
  });
});
