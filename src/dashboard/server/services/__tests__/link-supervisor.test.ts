/**
 * PAN-4645 WI-18: the link supervisor under fake timers with a fake channel
 * opener and a fake heartbeat stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelOpenError } from '../../../../lib/anywhere/channel/open.js';
import type { ChannelSocket } from '../../../../lib/anywhere/channel/channel-socket.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { linkFetch, openLinkSocket } from '../../../../lib/anywhere/link-client.js';
import type { HeartbeatHandlers, HeartbeatPayload } from '../link-heartbeat.js';
import {
  BACKOFF_CAP_MS,
  diagnoseGap,
  HEARTBEAT_DEAD_MS,
  HEARTBEAT_LATE_MS,
  LinkSupervisor,
  type LinkSupervisorDeps,
  PROBE_TIMEOUT_MS,
} from '../link-supervisor.js';

const PEER_KEY = 'b2'.repeat(32);
const ROUTE = 'tcp://100.101.1.2:3011';

function link(overrides: Partial<MachineLink> = {}): MachineLink {
  return {
    id: 'link-1', environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes: [{ url: ROUTE, kind: 'tailnet', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' }],
    createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null, ...overrides,
  };
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    descriptorVersion: 1, environmentId: 'env-peer', label: 'peer', platform: { os: 'linux', arch: 'x64' }, serverVersion: '0.73.0',
    protocolVersion: 1, capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true },
    machineKey: PEER_KEY, linkProtocol: 1, endpoints: [], ...overrides,
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
  /** Make every probe fail (unreachable) or succeed. */
  setReachable(reachable: boolean): void;
  /** While frozen the peer answers no handshake; probes hang until unfrozen or aborted. */
  setFrozen(frozen: boolean): void;
  opens: string[];
  channels: FakeChannel[];
  heartbeats: Array<{ channel: FakeChannel; handlers: HeartbeatHandlers; closed: boolean }>;
  beat(payload?: Partial<HeartbeatPayload>): void;
  now(): number;
  links: MachineLink[];
  revoked: string[];
  peer: Record<string, unknown>;
}

function harness(options: { reachable?: boolean; heartbeatStatus?: number; peer?: Record<string, unknown>; openError?: () => Error } = {}): Harness {
  let reachable = options.reachable ?? true;
  let frozen = false;
  const thaw: Array<() => void> = [];
  const opens: string[] = [];
  const channels: FakeChannel[] = [];
  const heartbeats: Harness['heartbeats'] = [];
  const revoked: string[] = [];
  const links = [link()];
  const peer = options.peer ?? descriptor();
  const deps: LinkSupervisorDeps = {
    linksSnapshot: () => links,
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    openChannel: vi.fn(async (url, opts) => {
      opens.push(url);
      await new Promise<void>((resolve, reject) => {
        let timer: NodeJS.Timeout | null = null;
        const abort = (): void => { if (timer) clearTimeout(timer); reject(new ChannelOpenError('aborted', 'aborted')); };
        opts.signal?.addEventListener('abort', abort, { once: true });
        if (frozen) {
          thaw.push(() => { timer = setTimeout(resolve, 10); });
          return;
        }
        timer = setTimeout(resolve, reachable ? 10 : PROBE_TIMEOUT_MS);
      });
      if (!reachable) throw new ChannelOpenError('unreachable', `${url}: ECONNREFUSED`);
      if (options.openError) throw options.openError();
      const channel = new FakeChannel(url);
      channels.push(channel);
      return channel as unknown as ChannelSocket;
    }),
    channelRequest: vi.fn(async () => ({ status: 200, json: peer })),
    openHeartbeat: vi.fn(async (channel, _token, handlers) => {
      if (options.heartbeatStatus && options.heartbeatStatus !== 200) {
        throw Object.assign(new Error(`heartbeat refused with status ${options.heartbeatStatus}`), { status: options.heartbeatStatus });
      }
      const entry = { channel: channel as unknown as FakeChannel, handlers, closed: false };
      heartbeats.push(entry);
      return { close: () => { entry.closed = true; } };
    }),
    markLinkRevoked: vi.fn(async (id: string) => { revoked.push(id); return null; }),
    setLinkRoutes: vi.fn(async () => null),
    serverVersion: '0.73.0',
    now: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
  };
  const supervisor = new LinkSupervisor(deps);
  return {
    supervisor, deps, opens, channels, heartbeats, links, revoked, peer,
    setReachable: (next) => { reachable = next; },
    setFrozen: (next) => {
      frozen = next;
      if (!next) for (const release of thaw.splice(0)) release();
    },
    beat: (payload = {}) => {
      const live = heartbeats.filter((entry) => !entry.closed).at(-1);
      if (!live) throw new Error('no live heartbeat stream');
      live.handlers.onHeartbeat({ seq: 1, lastStall: null, endpointsHash: '', serverVersion: '0.73.0', ...payload });
    },
    now: () => Date.now(),
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

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('link supervisor (PAN-4645 WI-18)', () => {
  it('comes online over the pairing route and reports it', async () => {
    h = harness();
    h.supervisor.start();
    await settle(50);
    const status = h.supervisor.status('link-1');
    expect(status.state).toBe('online');
    expect(status.currentRoute).toBe(ROUTE);
    expect(status.peerVersion).toBe('0.73.0');
    expect(status.routeStatus(ROUTE)).toBe('current');
    expect(h.opens).toEqual([ROUTE]);
    expect(h.supervisor.routeFor('env-peer')).toMatchObject({ state: 'online', url: ROUTE, machineKey: PEER_KEY });
  });

  it('ac1: without heartbeats the link is connecting at 17.5 s and offline by 20 s', async () => {
    h = harness();
    h.supervisor.start();
    await settle(50);
    h.setReachable(false); // the transport dropped: probes fail from now on
    await settle(HEARTBEAT_LATE_MS - 50);
    expect(h.supervisor.status('link-1').state).toBe('online');
    await settle(10);
    expect(h.supervisor.status('link-1').state).toBe('connecting');
    expect(h.channels[0]!.destroyed).toBe(false); // old channel kept while probing
    await settle(HEARTBEAT_DEAD_MS - HEARTBEAT_LATE_MS);
    expect(h.channels[0]!.destroyed).toBe(true);
    await settle(10);
    // Offline by 20 s; the first retry (1 s later) will show connecting while it probes.
    expect(h.supervisor.status('link-1').state).toBe('offline');
    await settle(1000 + 10);
    expect(h.supervisor.status('link-1').state).toBe('connecting');
    await settle(PROBE_TIMEOUT_MS);
    expect(h.supervisor.status('link-1').state).toBe('offline');
  });

  it('ac2: an offline link at the back-off cap is online within 47.5 s of the transport returning', async () => {
    h = harness({ reachable: false });
    h.supervisor.start();
    // Walk the back-off up to its cap: 1, 2, 4, 8, 16, 32, 45, 45 ...
    await settle(5 * 60_000);
    expect(h.supervisor.status('link-1').state).toBe('offline');
    const attemptsBefore = h.opens.length;
    h.setReachable(true);
    await settle(BACKOFF_CAP_MS + PROBE_TIMEOUT_MS);
    expect(h.supervisor.status('link-1').state).toBe('online');
    expect(h.opens.length).toBeGreaterThan(attemptsBefore);
  });

  it('ac3: a heartbeat 5 s late reporting a 5000 ms stall keeps the link online with incident froze', async () => {
    h = harness();
    h.supervisor.start();
    await settle(50);
    h.beat();
    await settle(HEARTBEAT_LATE_MS - 2500); // the peer's event loop freezes 15 s in: no heartbeat, no handshakes
    h.setFrozen(true);
    await settle(2600); // late: connecting, probing, old channel kept, probes hang on the frozen peer
    expect(h.supervisor.status('link-1').state).toBe('connecting');
    expect(h.channels[0]!.destroyed).toBe(false);
    await settle(HEARTBEAT_DEAD_MS - HEARTBEAT_LATE_MS - 200); // 19.9 s after the previous heartbeat the peer thaws
    h.setFrozen(false);
    h.beat({ lastStall: { durationMs: 5000, endedAgoMs: 0 } });
    await settle(10);
    const status = h.supervisor.status('link-1');
    expect(status.state).toBe('online');
    expect(status.incident).toMatchObject({ kind: 'froze', durationMs: 5000 });
    expect(h.channels[0]!.destroyed).toBe(false);
    expect(h.channels.filter((channel) => !channel.destroyed)).toHaveLength(1);
    // No heartbeat after that and nothing answering: it drops to connecting, then offline, as usual.
    h.setReachable(false);
    await settle(HEARTBEAT_DEAD_MS + PROBE_TIMEOUT_MS);
    expect(h.supervisor.status('link-1').state).not.toBe('online');
  });

  it('ac4: a heartbeat 401 marks the link revoked with no further probes; a peer without machineLinks is unsupported until reconnect', async () => {
    h = harness({ heartbeatStatus: 401 });
    h.supervisor.start();
    await settle(50);
    expect(h.supervisor.status('link-1').state).toBe('revoked');
    expect(h.revoked).toEqual(['link-1']);
    const opens = h.opens.length;
    await settle(10 * 60_000);
    expect(h.opens.length).toBe(opens);
    expect(h.supervisor.reconnect('link-1')).toBe(false);
    h.supervisor.stop();

    h = harness({ peer: descriptor({ capabilities: { pairing: true, deviceSessions: true, terminalAuth: true }, linkProtocol: undefined }) });
    h.supervisor.start();
    await settle(50);
    const status = h.supervisor.status('link-1');
    expect(status.state).toBe('unsupported');
    expect(status.stateDetail).toContain('Install Overdeck 0.73.0 on peer');
    expect(status.stateDetail?.endsWith(': npm install -g @overdeck/core@0.73.0')).toBe(true);
    const probes = h.opens.length;
    await settle(10 * 60_000);
    expect(h.opens.length).toBe(probes);
    expect(await openLinkSocket('env-peer', { routeSource: h.supervisor }).catch((error: Error) => error)).toMatchObject({ code: 'machine-unsupported' });

    h.peer.capabilities = { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true };
    h.peer.linkProtocol = 1;
    expect(h.supervisor.reconnect('link-1')).toBe(true);
    await settle(50);
    expect(h.supervisor.status('link-1').state).toBe('online');
  });

  it('unsupported: a peer one link protocol behind (refusal 02 from an older responder) names this machine\'s version and the npm command', async () => {
    h = harness({ openError: () => new ChannelOpenError('unsupported', 'link protocol mismatch', { linkProtocol: 0, serverVersion: '0.71.0' }) });
    h.supervisor.start();
    await settle(50);
    const status = h.supervisor.status('link-1');
    expect(status.state).toBe('unsupported');
    expect(status.stateDetail).toBe('Install Overdeck 0.73.0 on peer: npm install -g @overdeck/core@0.73.0');
    expect(status.unsupported).toEqual({ version: '0.73.0', on: 'peer' });
    const opens = h.opens.length;
    await settle(10 * 60_000);
    expect(h.opens.length).toBe(opens);
  });

  it('unsupported: a newer responder (refusal 02, linkProtocol 2) names its version on this machine', async () => {
    h = harness({ openError: () => new ChannelOpenError('unsupported', 'link protocol mismatch', { linkProtocol: 2, serverVersion: '0.80.0' }) });
    h.supervisor.start();
    await settle(50);
    const status = h.supervisor.status('link-1');
    expect(status.stateDetail).toBe('Install Overdeck 0.80.0 on this machine: npm install -g @overdeck/core@0.80.0');
    expect(status.unsupported).toEqual({ version: '0.80.0', on: 'this-machine' });
  });

  it('reconnect clears unsupported', async () => {
    h = harness({ peer: descriptor({ linkProtocol: 0 }) });
    h.supervisor.start();
    await settle(50);
    expect(h.supervisor.status('link-1').unsupported).toEqual({ version: '0.73.0', on: 'peer' });
    const opens = h.opens.length;
    await settle(10 * 60_000);
    expect(h.opens.length).toBe(opens);
    h.peer.linkProtocol = 1;
    expect(h.supervisor.reconnect('link-1')).toBe(true);
    expect(h.supervisor.status('link-1').unsupported).toBeNull();
    await settle(50);
    expect(h.supervisor.status('link-1')).toMatchObject({ state: 'online', unsupported: null });
  });

  it('ac5: linkFetch to an offline link rejects at once; to a connecting unreachable link at 2.5 s', async () => {
    h = harness({ reachable: false });
    h.supervisor.start();
    await settle(PROBE_TIMEOUT_MS + 10);
    expect(h.supervisor.status('link-1').state).toBe('offline');
    const started = Date.now();
    const offline = await linkFetch('env-peer', '/api/issues', { routeSource: h.supervisor }).catch((error: Error) => error);
    expect(offline).toMatchObject({ code: 'machine-offline' });
    expect(Date.now() - started).toBeLessThan(10);

    // Back to connecting: the 1 s retry probe starts at exactly 3.5 s and nothing answers.
    await settle(990);
    expect(h.supervisor.status('link-1').state).toBe('connecting');
    const pending = linkFetch('env-peer', '/api/issues', { routeSource: h.supervisor }).catch((error: Error) => error);
    await settle(2_499);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await settle(1);
    expect(await pending).toMatchObject({ code: 'machine-unreachable' });
  });

  it('reconcile tears down removed links and adopts new ones; stop closes channels', async () => {
    h = harness();
    h.supervisor.start();
    await settle(50);
    h.links.splice(0, 1, link({ id: 'link-2', environmentId: 'env-two', label: 'two' }));
    h.peer.environmentId = 'env-two';
    h.supervisor.reconcile();
    await settle(50);
    expect(h.channels[0]!.destroyed).toBe(true);
    expect(h.supervisor.status('link-2').state).toBe('online');
    expect(h.supervisor.routeFor('env-peer')).toBeNull();
    h.supervisor.stop();
    expect(h.channels.every((channel) => channel.destroyed)).toBe(true);
  });

  it('PAN-4650: hands each heartbeat on the current channel and the connect descriptor to the hooks', async () => {
    h = harness();
    const onHeartbeat = vi.fn();
    const onDescriptor = vi.fn();
    h.deps.onHeartbeat = onHeartbeat;
    h.deps.onDescriptor = onDescriptor;
    h.supervisor.start();
    await settle(50);
    expect(onDescriptor).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'env-peer' }), expect.objectContaining({ environmentId: 'env-peer' }));
    h.beat({ conversationsHash: 'abcd' });
    expect(onHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'env-peer' }), expect.objectContaining({ conversationsHash: 'abcd' }));
  });

  it('diagnoseGap: froze only for a stall of at least 2 s that ended inside a late gap', () => {
    const at = Date.parse('2026-11-01T12:00:20.000Z');
    expect(diagnoseGap(15_000, { durationMs: 5000, endedAgoMs: 0 }, at)).toBeNull();
    expect(diagnoseGap(20_000, { durationMs: 5000, endedAgoMs: 0 }, at)).toMatchObject({ kind: 'froze', durationMs: 5000 });
    expect(diagnoseGap(20_000, { durationMs: 5000, endedAgoMs: 30_000 }, at)).toMatchObject({ kind: 'network', durationMs: 5000 });
    expect(diagnoseGap(20_000, { durationMs: 1500, endedAgoMs: 0 }, at)).toMatchObject({ kind: 'network' });
    expect(diagnoseGap(25_000, null, at)).toMatchObject({ kind: 'network', durationMs: 10_000, at: '2026-11-01T12:00:20.000Z' });
  });
});
