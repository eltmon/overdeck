/**
 * PAN-4645 WI-19: advertised-endpoint discovery with an injected interface
 * table, tailscale runner and fetch; the endpoints hash; the cached advertiser.
 */
import type { NetworkInterfaceInfo } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverEndpoints,
  type DiscoverEndpointsDeps,
  ENDPOINT_REFRESH_MS,
  EndpointAdvertiser,
  endpointsHash,
  interfaceEndpoints,
} from '../endpoints.js';

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` };
}

const INTERFACES: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  lo: [v4('127.0.0.1', true)],
  enp3s0: [v4('192.168.1.5'), { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:00', internal: false, cidr: 'fe80::1/64', scopeid: 2 }],
  docker0: [v4('172.17.0.1')],
  'br-9f3a': [v4('172.18.0.1')],
  tailscale0: [v4('100.101.1.2')],
  wlan0: [v4('203.0.113.9')], // public: never advertised as lan
};

function deps(overrides: Partial<DiscoverEndpointsDeps> = {}): DiscoverEndpointsDeps {
  return {
    port: 3011,
    environmentId: 'env-self',
    networkInterfaces: () => INTERFACES,
    execFile: vi.fn(async () => { throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }); }),
    fetch: vi.fn(async () => ({ ok: true, json: async () => ({ environmentId: 'env-self' }) })),
    ...overrides,
  };
}

const tailscaleStatus = { stdout: JSON.stringify({ Self: { DNSName: 'desk.tail1234.ts.net.' } }) };

afterEach(() => {
  vi.useRealTimers();
});

describe('advertised endpoints (PAN-4645 WI-19)', () => {
  it('ac1: lan from a real interface, nothing from docker/bridge/public, tailnet from 100.64/10', () => {
    expect(interfaceEndpoints(3011, INTERFACES)).toEqual([
      { kind: 'lan', url: 'tcp://192.168.1.5:3011' },
      { kind: 'tailnet', url: 'tcp://100.101.1.2:3011' },
    ]);
  });

  it('ac1: discoverEndpoints without a tailscale binary returns the sorted interface endpoints', async () => {
    const d = deps();
    await expect(discoverEndpoints(d)).resolves.toEqual([
      { kind: 'tailnet', url: 'tcp://100.101.1.2:3011' },
      { kind: 'lan', url: 'tcp://192.168.1.5:3011' },
    ]);
    expect(d.execFile).toHaveBeenCalledWith('tailscale', ['status', '--json'], { timeout: 5000 });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('advertises nothing under OVERDECK_ANYWHERE_NO_ADVERTISE=1 (PAN-2356 directory smoke)', async () => {
    vi.stubEnv('OVERDECK_ANYWHERE_NO_ADVERTISE', '1');
    try {
      const d = deps();
      await expect(discoverEndpoints(d)).resolves.toEqual([]);
      expect(d.execFile).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('advertises nothing under OVERDECK_PUBLIC_LINK_ONLY=1 (PAN-4741 Fly machine)', async () => {
    vi.stubEnv('OVERDECK_PUBLIC_LINK_ONLY', '1');
    try {
      const d = deps({ networkInterfaces: () => ({ eth0: [v4('172.19.4.10')] }) });
      await expect(discoverEndpoints(d)).resolves.toEqual([]);
      expect(d.execFile).not.toHaveBeenCalled();
      expect(d.fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('still advertises when OVERDECK_PUBLIC_LINK_ONLY is not exactly 1', async () => {
    vi.stubEnv('OVERDECK_PUBLIC_LINK_ONLY', 'true');
    try {
      const d = deps({ networkInterfaces: () => ({ eth0: [v4('172.19.4.10')] }) });
      await expect(discoverEndpoints(d)).resolves.toEqual([{ kind: 'lan', url: 'tcp://172.19.4.10:3011' }]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('ac2: Tailscale Serve is advertised only when the self-check answers with our environment id', async () => {
    const matching = deps({ execFile: vi.fn(async () => tailscaleStatus) });
    const found = await discoverEndpoints(matching);
    expect(found).toContainEqual({ kind: 'tailnet', url: 'wss://desk.tail1234.ts.net/ws/link' });
    expect(matching.fetch).toHaveBeenCalledWith('https://desk.tail1234.ts.net/api/environment', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    const other = deps({ execFile: vi.fn(async () => tailscaleStatus), fetch: vi.fn(async () => ({ ok: true, json: async () => ({ environmentId: 'env-other' }) })) });
    expect((await discoverEndpoints(other)).some((endpoint) => endpoint.url.startsWith('wss://'))).toBe(false);

    const unreachable = deps({ execFile: vi.fn(async () => tailscaleStatus), fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) });
    expect((await discoverEndpoints(unreachable)).some((endpoint) => endpoint.url.startsWith('wss://'))).toBe(false);

    const noName = deps({ execFile: vi.fn(async () => ({ stdout: JSON.stringify({ Self: {} }) })) });
    expect((await discoverEndpoints(noName)).some((endpoint) => endpoint.url.startsWith('wss://'))).toBe(false);
    expect(noName.fetch).not.toHaveBeenCalled();
  });

  it('endpointsHash is 16 hex of the sorted URLs, order-independent, and empty for no endpoints', () => {
    const a = endpointsHash([{ kind: 'lan', url: 'tcp://192.168.1.5:3011' }, { kind: 'tailnet', url: 'tcp://100.101.1.2:3011' }]);
    const b = endpointsHash([{ kind: 'tailnet', url: 'tcp://100.101.1.2:3011' }, { kind: 'lan', url: 'tcp://192.168.1.5:3011' }]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(endpointsHash([{ kind: 'lan', url: 'tcp://192.168.1.6:3011' }])).not.toBe(a);
    expect(endpointsHash([])).toBe('');
  });

  it('the advertiser caches discovery, refreshes every 10 min, and keeps the last answer when a refresh throws', async () => {
    vi.useFakeTimers();
    let table = INTERFACES;
    const networkInterfaces = vi.fn(() => table);
    const advertiser = new EndpointAdvertiser(deps({ networkInterfaces }));
    expect(advertiser.current()).toEqual([]);
    expect(advertiser.hash()).toBe('');
    await advertiser.start();
    expect(advertiser.current()).toHaveLength(2);
    const first = advertiser.hash();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(networkInterfaces).toHaveBeenCalledTimes(1);

    table = { enp3s0: [v4('192.168.1.7')] };
    await vi.advanceTimersByTimeAsync(ENDPOINT_REFRESH_MS);
    expect(networkInterfaces).toHaveBeenCalledTimes(2);
    expect(advertiser.current()).toEqual([{ kind: 'lan', url: 'tcp://192.168.1.7:3011' }]);
    expect(advertiser.hash()).not.toBe(first);

    networkInterfaces.mockImplementation(() => { throw new Error('EPERM'); });
    await advertiser.refresh();
    expect(advertiser.current()).toEqual([{ kind: 'lan', url: 'tcp://192.168.1.7:3011' }]);
    advertiser.stop();
    await vi.advanceTimersByTimeAsync(ENDPOINT_REFRESH_MS * 2);
    expect(networkInterfaces).toHaveBeenCalledTimes(3);
  });
});
