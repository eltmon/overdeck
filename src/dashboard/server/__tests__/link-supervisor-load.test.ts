/**
 * PAN-4651 WI-2 (D-4651-8): a heartbeat's load, tags and placement reach the
 * supervisor's `status()` and the machine view; an old peer's beat leaves the
 * defaults (null / [] / 'auto').
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelSocket } from '../../../lib/anywhere/channel/channel-socket.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import type { HeartbeatHandlers, HeartbeatPayload } from '../services/link-heartbeat.js';
import { LinkSupervisor, type LinkSupervisorDeps } from '../services/link-supervisor.js';
import { machineLinkView } from '../services/machine-link-service.js';

const PEER_KEY = 'b2'.repeat(32);
const ROUTE = 'tcp://100.101.1.2:3011';
const LINK: MachineLink = {
  id: 'link-1', environmentId: 'env-desk', label: 'desk', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
  reverseTokenId: null, routes: [{ url: ROUTE, kind: 'tailnet', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' }],
  createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
};
const DESCRIPTOR = {
  descriptorVersion: 1, environmentId: 'env-desk', label: 'desk', platform: { os: 'linux', arch: 'x64' }, serverVersion: '0.73.0',
  protocolVersion: 1, capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true },
  machineKey: PEER_KEY, linkProtocol: 1, endpoints: [],
};

let supervisor: LinkSupervisor;
let streams: HeartbeatHandlers[];

function beat(payload: Partial<HeartbeatPayload> & Record<string, unknown> = {}): void {
  const live = streams.at(-1);
  if (!live) throw new Error('no heartbeat stream');
  live.onHeartbeat({ seq: 1, lastStall: null, endpointsHash: '', serverVersion: '0.73.0', ...payload } as HeartbeatPayload);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
  streams = [];
  const deps: LinkSupervisorDeps = {
    linksSnapshot: () => [LINK],
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    openChannel: vi.fn(async (url: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { url, channel: { mode: 'link', remoteKeyHex: PEER_KEY, pairingId: null }, destroy: () => undefined } as unknown as ChannelSocket;
    }),
    channelRequest: vi.fn(async () => ({ status: 200, json: DESCRIPTOR })),
    openHeartbeat: vi.fn(async (_channel, _token, handlers: HeartbeatHandlers) => {
      streams.push(handlers);
      return { close: () => undefined };
    }),
    markLinkRevoked: vi.fn(async () => null),
    setLinkRoutes: vi.fn(async () => null),
    serverVersion: '0.73.0',
    now: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
  };
  supervisor = new LinkSupervisor(deps);
  supervisor.start();
  await vi.advanceTimersByTimeAsync(50);
});

afterEach(() => {
  supervisor.stop();
  vi.useRealTimers();
});

describe('link supervisor load (D-4651-8)', () => {
  it('ac: a heartbeat carrying load, tags and placement shows in status() and the machine view', async () => {
    expect(supervisor.status('link-1').state).toBe('online');
    const load = { cpuPsiSomeAvg10: 3.4, cpuSaturated: false, memAvailableBytes: 44_040_192_000, workingAgents: 2, sampledAt: '2026-11-01T12:00:00.000Z' };
    beat({ load, tags: ['linux', 'docker'], placement: 'on-request' });
    await vi.advanceTimersByTimeAsync(15_000);
    const status = supervisor.status('link-1');
    expect(status.load).toEqual(load);
    expect(status.tags).toEqual(['docker', 'linux']);
    expect(status.placement).toBe('on-request');
    expect(machineLinkView(LINK, null, supervisor)).toMatchObject({ load, tags: ['docker', 'linux'], placement: 'on-request' });
  });

  it('an old peer heartbeat without the fields leaves load null, tags [] and placement auto', async () => {
    beat();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(supervisor.status('link-1')).toMatchObject({ load: null, tags: [], placement: 'auto' });
  });

  it('an unknown link reports the defaults', () => {
    expect(supervisor.status('link-unknown')).toMatchObject({ load: null, tags: [], placement: 'auto' });
  });
});
