/**
 * PAN-4897 WI-4: the link supervisor names the macOS Local Network denial only once two
 * signals agree — every LAN tcp:// route failed with EHOSTUNREACH, and the injected
 * gateway probe confirms this process's own access is denied. Fake timers; a fake
 * channel opener that always rejects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelOpenError } from '../../../../lib/anywhere/channel/open.js';
import type { LocalNetworkAccess } from '../../../../lib/anywhere/local-network-probe.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import { BACKOFF_CAP_MS, LinkSupervisor, type LinkSupervisorDeps } from '../link-supervisor.js';

const ENV = '0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234';
const PEER_KEY = 'b2'.repeat(32);
const LAN_1 = 'tcp://192.168.1.64:3011';
const LAN_2 = 'tcp://192.168.1.86:3011';
const TAILNET = 'tcp://100.101.1.2:3011';
const DIRECT = `rtc://${ENV}`;
const AT = '2026-11-01T00:00:00.000Z';
const NODE_PATH = '/opt/homebrew/bin/node';

function stored(url: string, kind: LinkRoute['kind'] = 'lan'): LinkRoute {
  return { url, kind, source: 'pairing', addedAt: AT };
}

function link(routes: LinkRoute[]): MachineLink {
  return {
    id: 'link-1', environmentId: ENV, label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
    reverseTokenId: null, routes, createdAt: AT, revokedAt: null,
  };
}

/** A tcp open rejection carrying the given errno in ChannelOpenError.detail.cause. */
function openFailure(url: string, cause: string): ChannelOpenError {
  return new ChannelOpenError('unreachable', `${url}: ${cause}`, { cause });
}

function harness(options: {
  links: MachineLink[];
  failures: Record<string, string>;
  localNetworkAccess?: () => Promise<LocalNetworkAccess>;
  relayEntitled?: () => boolean;
  dynamicRoutes?: () => LinkRoute[];
}) {
  const openChannel = vi.fn(async (url: string) => {
    throw openFailure(url, options.failures[url] ?? 'ECONNREFUSED');
  });
  const log = vi.fn();
  const deps: LinkSupervisorDeps = {
    linksSnapshot: () => options.links,
    localKey: async () => ({ publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) }),
    openChannel: openChannel as unknown as LinkSupervisorDeps['openChannel'],
    channelRequest: vi.fn(async () => ({ status: 200, json: {} })),
    openHeartbeat: vi.fn(async () => ({ close: () => undefined })),
    markLinkRevoked: vi.fn(async () => null),
    setLinkRoutes: vi.fn(async () => null),
    serverVersion: '0.73.0',
    now: () => Date.now(),
    random: () => 0.5,
    log,
    localNetworkAccess: options.localNetworkAccess,
    nodePath: NODE_PATH,
    relayEntitled: options.relayEntitled,
    dynamicRoutes: options.dynamicRoutes,
  };
  return { supervisor: new LinkSupervisor(deps), openChannel, log };
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

describe('local network denial (PAN-4897 D-2, D-6)', () => {
  it('names the denial when every LAN route failed with EHOSTUNREACH and the gateway probe confirms it', async () => {
    const localNetworkAccess = vi.fn(async (): Promise<LocalNetworkAccess> => 'denied');
    const h = harness({
      links: [link([stored(LAN_1), stored(LAN_2)])],
      failures: { [LAN_1]: 'EHOSTUNREACH', [LAN_2]: 'EHOSTUNREACH' },
      localNetworkAccess,
    });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(localNetworkAccess).toHaveBeenCalledTimes(1);
    const status = supervisor.status('link-1');
    expect(status.state).toBe('offline');
    expect(status.stateDetail).toMatch(/^macOS is blocking local network access for Overdeck\./);
    expect(status.stateDetail).toContain(`turn on node (${NODE_PATH})`);
    expect(status.stateDetail?.endsWith(`Blocked routes: ${LAN_1}, ${LAN_2}`)).toBe(true);
  });

  it('keeps the raw joined detail when the gateway probe reports allowed', async () => {
    const localNetworkAccess = vi.fn(async (): Promise<LocalNetworkAccess> => 'allowed');
    const h = harness({
      links: [link([stored(LAN_1), stored(LAN_2)])],
      failures: { [LAN_1]: 'EHOSTUNREACH', [LAN_2]: 'EHOSTUNREACH' },
      localNetworkAccess,
    });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(localNetworkAccess).toHaveBeenCalledTimes(1);
    const status = supervisor.status('link-1');
    expect(status.state).toBe('offline');
    expect(status.stateDetail).toBe(`${LAN_1}: ${LAN_1}: EHOSTUNREACH; ${LAN_2}: ${LAN_2}: EHOSTUNREACH`);
  });

  it('never calls the gateway probe when it is not injected', async () => {
    const h = harness({ links: [link([stored(LAN_1)])], failures: { [LAN_1]: 'EHOSTUNREACH' } });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const status = supervisor.status('link-1');
    expect(status.stateDetail).toBe(`${LAN_1}: ${LAN_1}: EHOSTUNREACH`);
  });

  it('never calls the gateway probe when one LAN route failed with a different errno', async () => {
    const localNetworkAccess = vi.fn(async (): Promise<LocalNetworkAccess> => 'denied');
    const h = harness({
      links: [link([stored(LAN_1), stored(LAN_2)])],
      failures: { [LAN_1]: 'EHOSTUNREACH', [LAN_2]: 'ECONNREFUSED' },
      localNetworkAccess,
    });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(localNetworkAccess).not.toHaveBeenCalled();
  });

  it('never calls the gateway probe when the only route is not a LAN address', async () => {
    const localNetworkAccess = vi.fn(async (): Promise<LocalNetworkAccess> => 'denied');
    const h = harness({
      links: [link([stored(TAILNET, 'tailnet')])],
      failures: { [TAILNET]: 'EHOSTUNREACH' },
      localNetworkAccess,
    });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(localNetworkAccess).not.toHaveBeenCalled();
  });

  it('shows the Local Network message instead of NO_DIRECT_PATH_MESSAGE when a direct route also fails and the plan has no relay', async () => {
    const localNetworkAccess = vi.fn(async (): Promise<LocalNetworkAccess> => 'denied');
    const h = harness({
      links: [link([stored(LAN_1)])],
      failures: { [LAN_1]: 'EHOSTUNREACH', [DIRECT]: 'ECONNREFUSED' },
      localNetworkAccess,
      relayEntitled: () => false,
      dynamicRoutes: () => [{ url: DIRECT, kind: 'direct', source: 'directory', addedAt: AT }],
    });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const status = supervisor.status('link-1');
    expect(status.stateDetail).toMatch(/^macOS is blocking local network access for Overdeck\./);
    expect(status.stateDetail).not.toContain('No direct path');
  });

  it('writes no stateDetail and schedules no retry when the link is removed while the gateway probe is pending', async () => {
    let resolveAccess: ((value: LocalNetworkAccess) => void) | undefined;
    const localNetworkAccess = vi.fn(() => new Promise<LocalNetworkAccess>((resolve) => { resolveAccess = resolve; }));
    const links = [link([stored(LAN_1)])];
    const h = harness({ links, failures: { [LAN_1]: 'EHOSTUNREACH' }, localNetworkAccess });
    supervisor = h.supervisor;
    supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(localNetworkAccess).toHaveBeenCalledTimes(1);

    links.length = 0;
    supervisor.reconcile();
    resolveAccess!('denied');
    await vi.advanceTimersByTimeAsync(BACKOFF_CAP_MS + 1_000);

    expect(h.openChannel).toHaveBeenCalledTimes(1);
    expect(supervisor.status('link-1')).toMatchObject({ state: 'connecting', stateDetail: null });
  });
});
