/**
 * PAN-5016 WI-7 (D-4, D-7): the supervisor reports a link's channel outcome as
 * `anywhere_channel_opened`, at most once per change in (route, ok, error_class).
 * Fake timers and a fake channel opener, as in link-supervisor-phases.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelOpenError } from '../../../../lib/anywhere/channel/open.js';
import type { ChannelSocket } from '../../../../lib/anywhere/channel/channel-socket.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import { LinkSupervisor, type LinkSupervisorDeps } from '../link-supervisor.js';

const ENV = '0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234';
const PEER_KEY = 'b2'.repeat(32);
const LAN = 'tcp://192.168.1.5:3011';
const DIRECT = `rtc://${ENV}`;
const AT = '2026-11-01T00:00:00.000Z';
const LAN_ROUTE: LinkRoute = { url: LAN, kind: 'lan', source: 'pairing', addedAt: AT };
const DIRECT_ROUTE: LinkRoute = { url: DIRECT, kind: 'direct', source: 'directory', addedAt: AT };

class FakeChannel {
  destroyed = false;
  readonly channel = { mode: 'link' as const, remoteKeyHex: PEER_KEY, pairingId: null };
  destroy(): void { this.destroyed = true; }
}

interface HarnessOptions {
  stored: LinkRoute[];
  dynamic?: LinkRoute[];
  reachable: string[];
  relay?: boolean;
  openHeartbeat?: LinkSupervisorDeps['openHeartbeat'];
}

function harness(options: HarnessOptions) {
  const reach = new Set(options.reachable);
  const reportChannelOpen = vi.fn();
  const peer = {
    descriptorVersion: 1, environmentId: ENV, label: 'peer', platform: { os: 'linux', arch: 'x64' }, serverVersion: '0.73.0',
    protocolVersion: 1, capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true },
    machineKey: PEER_KEY, linkProtocol: 1, endpoints: [],
  };
  const link: MachineLink = {
    id: 'link-1', environmentId: ENV, label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes: options.stored, createdAt: AT, revokedAt: null,
  };
  const openChannel = vi.fn<LinkSupervisorDeps['openChannel']>(async (url) => {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    if (!reach.has(url)) throw new ChannelOpenError('unreachable', `${url}: no answer`);
    return new FakeChannel() as unknown as ChannelSocket;
  });
  const deps: LinkSupervisorDeps = {
    linksSnapshot: () => [link],
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    openChannel,
    channelRequest: vi.fn(async () => ({ status: 200, json: peer })),
    openHeartbeat: options.openHeartbeat ?? vi.fn(async (_channel, _token, handlers) => {
      handlers.onHeartbeat({ seq: 1, lastStall: null, endpointsHash: 'h', serverVersion: '0.73.0' });
      const timer = setInterval(() => handlers.onHeartbeat({ seq: 2, lastStall: null, endpointsHash: 'h', serverVersion: '0.73.0' }), 15_000);
      return { close: () => clearInterval(timer) };
    }),
    markLinkRevoked: vi.fn(async () => null),
    setLinkRoutes: vi.fn(async () => null),
    serverVersion: '0.73.0',
    now: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
    reportChannelOpen,
    ...(options.dynamic ? { dynamicRoutes: () => options.dynamic! } : {}),
    ...(options.relay !== undefined ? { relayEntitled: () => options.relay! } : {}),
  };
  return { supervisor: new LinkSupervisor(deps), openChannel, reportChannelOpen };
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

describe('channel outcome telemetry (PAN-5016 WI-7)', () => {
  it('reports one success with the winning route kind', async () => {
    const h = harness({ stored: [LAN_ROUTE], reachable: [LAN] });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(supervisor.status('link-1')).toMatchObject({ state: 'online' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.reportChannelOpen.mock.calls).toEqual([[{ route: 'lan', ok: true, error_class: 'none' }]]);
  });

  it('reports ten consecutive identical probe failures exactly once', async () => {
    const h = harness({ stored: [LAN_ROUTE], reachable: [] });
    supervisor = h.supervisor;
    supervisor.start();
    for (let step = 0; step < 200 && h.openChannel.mock.calls.length < 10; step += 1) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(h.openChannel.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(supervisor.status('link-1')).toMatchObject({ state: 'offline' });
    expect(h.reportChannelOpen.mock.calls).toEqual([[{ route: 'stored', ok: false, error_class: 'unreachable' }]]);
  });

  it('reports no_relay_plan on the direct phase when direct fails and the plan has no relay', async () => {
    const h = harness({ stored: [], dynamic: [DIRECT_ROUTE], reachable: [], relay: false });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.reportChannelOpen.mock.calls).toEqual([[{ route: 'direct', ok: false, error_class: 'no_relay_plan' }]]);
  });

  it('reports revoked when the heartbeat answers 401', async () => {
    const h = harness({
      stored: [LAN_ROUTE],
      reachable: [LAN],
      openHeartbeat: vi.fn(async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); }),
    });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(supervisor.status('link-1')).toMatchObject({ state: 'revoked' });
    expect(h.reportChannelOpen.mock.calls).toEqual([[{ route: 'lan', ok: false, error_class: 'revoked' }]]);
  });
});
