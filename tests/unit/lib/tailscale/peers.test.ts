import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CONCURRENT_PROBES,
  PEER_PROBE_TIMEOUT_MS,
  discoverTailnetPeers,
  type JsonGetter,
} from '../../../../src/lib/tailscale/peers.js';
import type { TailscalePeer } from '../../../../src/lib/tailscale/state.js';

const PORT = 3011;
const SELF = 'env-self';

function descriptor(environmentId: string, label = 'laptop') {
  return {
    descriptorVersion: 1,
    environmentId,
    label,
    platform: { os: 'darwin', arch: 'arm64' },
    serverVersion: '0.72.0',
    protocolVersion: 1,
    capabilities: { pairing: true, deviceSessions: true, terminalAuth: true },
  };
}

function peer(hostName: string, ip: string, overrides: Partial<TailscalePeer> = {}): TailscalePeer {
  return { hostName, dnsName: `${hostName}.tailnet.ts.net`, ipv4: [ip], os: 'linux', online: true, ...overrides };
}

/** A getter that answers per URL and never answers unknown URLs until aborted. */
function getter(answers: Record<string, unknown>) {
  return vi.fn<JsonGetter>((url, signal) => new Promise((resolve, reject) => {
    if (url in answers) {
      const value = answers[url];
      if (value instanceof Error) reject(value);
      else resolve(value);
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('discoverTailnetPeers', () => {
  it('returns a peer whose http candidate answers with a descriptor', async () => {
    const fetchJson = getter({
      'http://100.64.0.2:3011/api/environment': descriptor('env-laptop'),
      'https://laptop.tailnet.ts.net/api/environment': new Error('ECONNREFUSED'),
    });
    const peers = await discoverTailnetPeers({ mode: 'system', peers: [peer('laptop', '100.64.0.2')] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson });
    expect(peers).toEqual([{
      hostName: 'laptop',
      dnsName: 'laptop.tailnet.ts.net',
      os: 'linux',
      online: true,
      overdeck: { environmentId: 'env-laptop', label: 'laptop', serverVersion: '0.72.0', url: 'http://100.64.0.2:3011' },
    }]);
  });

  it('probes both candidates in parallel and takes the first valid answer', async () => {
    const fetchJson = getter({ 'https://laptop.tailnet.ts.net/api/environment': descriptor('env-laptop') });
    const peers = await discoverTailnetPeers({ mode: 'system', peers: [peer('laptop', '100.64.0.2')] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson });
    expect(fetchJson.mock.calls.map(([url]) => url).sort()).toEqual([
      'http://100.64.0.2:3011/api/environment',
      'https://laptop.tailnet.ts.net/api/environment',
    ]);
    expect(peers[0].overdeck?.url).toBe('https://laptop.tailnet.ts.net');
  });

  it('gives up on a peer that never answers after 2.5 s', async () => {
    vi.useFakeTimers();
    const fetchJson = getter({});
    let settled = false;
    const pending = discoverTailnetPeers({ mode: 'system', peers: [peer('silent', '100.64.0.9')] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson })
      .finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(PEER_PROBE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)[0].overdeck).toBeNull();
  });

  it('omits this machine', async () => {
    const fetchJson = getter({ 'http://100.64.0.1:3011/api/environment': descriptor(SELF, 'desk') });
    const peers = await discoverTailnetPeers({ mode: 'system', peers: [peer('desk-alias', '100.64.0.1', { dnsName: null })] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson });
    expect(peers).toEqual([]);
  });

  it('returns an offline peer without probing it', async () => {
    const fetchJson = getter({});
    const peers = await discoverTailnetPeers({ mode: 'system', peers: [peer('phone', '100.64.0.3', { online: false })] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson });
    expect(peers).toEqual([{ hostName: 'phone', dnsName: 'phone.tailnet.ts.net', os: 'linux', online: false, overdeck: null }]);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('treats an invalid descriptor as no Overdeck', async () => {
    const fetchJson = getter({
      'http://100.64.0.2:3011/api/environment': { hello: 'world' },
      'https://laptop.tailnet.ts.net/api/environment': new SyntaxError('Unexpected token <'),
    });
    const peers = await discoverTailnetPeers({ mode: 'system', peers: [peer('laptop', '100.64.0.2')] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson });
    expect(peers[0].overdeck).toBeNull();
  });

  it('in userspace mode sends only the http probe, through the proxy', async () => {
    const fetchJson = getter({});
    const proxyJson = getter({ 'http://100.64.0.2:3011/api/environment': descriptor('env-laptop') });
    const peers = await discoverTailnetPeers({ mode: 'userspace', peers: [peer('laptop', '100.64.0.2')] }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson, proxyJson });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(proxyJson.mock.calls.map(([url]) => url)).toEqual(['http://100.64.0.2:3011/api/environment']);
    expect(peers[0].overdeck?.environmentId).toBe('env-laptop');
  });

  it(`runs at most ${MAX_CONCURRENT_PROBES} probes at once`, async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let peak = 0;
    const fetchJson = vi.fn<JsonGetter>((_url, signal) => new Promise((_resolve, reject) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      signal.addEventListener('abort', () => {
        inFlight -= 1;
        reject(new Error('aborted'));
      });
    }));
    const many = Array.from({ length: 20 }, (_, i) => peer(`host${i}`, `100.64.1.${i}`));
    const pending = discoverTailnetPeers({ mode: 'system', peers: many }, { port: PORT, selfEnvironmentId: SELF }, { fetchJson });
    await vi.advanceTimersByTimeAsync(PEER_PROBE_TIMEOUT_MS * 3);
    const peers = await pending;
    expect(peak).toBe(MAX_CONCURRENT_PROBES);
    expect(fetchJson).toHaveBeenCalledTimes(40);
    expect(peers.every((p) => p.overdeck === null)).toBe(true);
  });
});
