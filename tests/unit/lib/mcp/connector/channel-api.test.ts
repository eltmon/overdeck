import type { DirectoryMachine } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelSocket } from '../../../../../src/lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError, setRtcDialer, type TransportUrl } from '../../../../../src/lib/anywhere/channel/open.js';
import { _resetLinkClientForTests, type LinkFetchInit } from '../../../../../src/lib/anywhere/link-client.js';
import {
  ConnectorLink,
  createConnectorDashboardApi,
  noDirectPathMessage,
} from '../../../../../src/lib/mcp/connector/channel-api.js';
import type { ConnectorIdentity, ConnectorPairing } from '../../../../../src/lib/mcp/connector/home.js';

const PAIRING: ConnectorPairing = {
  v: 1,
  environmentId: 'env-1',
  machineKeyHex: 'a'.repeat(64),
  machineLabel: 'studio',
  token: `odk_${'b'.repeat(64)}`,
  tokenId: 'tok-1',
  scopes: ['read:state'],
  pairedAt: '2026-11-04T00:00:00.000Z',
};

const IDENTITY: ConnectorIdentity = {
  v: 1,
  clientId: '0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0f9',
  linkPublicKey: '1'.repeat(64),
  linkSecretKey: '2'.repeat(64),
  installPublicKey: '3'.repeat(64),
  installSecretKey: '4'.repeat(64),
};

const MACHINE: DirectoryMachine = {
  environmentId: 'env-1',
  label: 'studio',
  publicKeyHex: 'a'.repeat(64),
  fingerprint: 'aaaa-aaaa-aaaa-aaaa-aaaa',
  online: true,
  lastSeenAt: '2026-11-04T00:00:00.000Z',
  serverVersion: '0.73.1',
  endpoints: [],
};

class FakeDirectory {
  state: 'off' | 'connecting' | 'online' | 'refused' = 'online';
  machines: readonly DirectoryMachine[] = [MACHINE];
  private readonly listeners = new Set<() => void>();

  onStateChange = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(machines: readonly DirectoryMachine[]): void {
    this.machines = machines;
    for (const listener of this.listeners) listener();
  }
}

const fakeSocket = (): ChannelSocket => ({ destroy: vi.fn() }) as unknown as ChannelSocket;

function setup(opts: { relayRefusal?: string | null; probe?: (url: TransportUrl) => Promise<ChannelSocket> } = {}) {
  const directory = new FakeDirectory();
  const transport = { close: vi.fn() };
  const probes: TransportUrl[] = [];
  const order: string[] = [];
  transport.close.mockImplementation(() => order.push('close'));
  const openProbe = vi.fn(async (url: TransportUrl) => {
    probes.push(url);
    order.push(`probe ${url}`);
    return (opts.probe ?? (async () => fakeSocket()))(url);
  });
  const link = new ConnectorLink({
    pairing: PAIRING,
    identity: IDENTITY,
    rtc: { transport, relayRefusal: () => opts.relayRefusal ?? null },
    directory,
    openProbe,
  });
  return { link, directory, transport, probes, order, openProbe };
}

const failing = async (): Promise<ChannelSocket> => {
  throw new ChannelOpenError('unreachable', 'ICE failed');
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  _resetLinkClientForTests();
  setRtcDialer(null);
});

describe('ConnectorLink', () => {
  it('is connecting until a direct probe succeeds, then online over rtc://', async () => {
    const { link } = setup();
    expect(link.routeFor('env-1')).toMatchObject({ state: 'connecting', url: null, token: PAIRING.token, machineKey: PAIRING.machineKeyHex });
    expect(link.routeFor('env-2')).toBeNull();
    await link.connect();
    expect(link.routeFor('env-1')).toMatchObject({ state: 'online', url: 'rtc://env-1' });
    expect(link.health()).toEqual({ ok: true, machine: 'studio', route: 'direct' });
    link.stop();
  });

  it('closes the probe channel', async () => {
    const socket = fakeSocket();
    const { link } = setup({ probe: async () => socket });
    await link.connect();
    expect(socket.destroy).toHaveBeenCalled();
    link.stop();
  });

  it('falls back to the relay when allowed', async () => {
    const { link, probes } = setup({ probe: async (url) => (url.startsWith('rtc://') ? failing() : fakeSocket()) });
    await link.connect();
    expect(probes).toEqual(['rtc://env-1', 'rtc+turn://env-1']);
    expect(link.routeFor('env-1')?.url).toBe('rtc+turn://env-1');
    expect(link.health().route).toBe('relay');
    link.stop();
  });

  it('is down with the no-direct-path sentence when the relay is refused', async () => {
    const { link, probes } = setup({ relayRefusal: 'The relay needs the relay plan', probe: failing });
    await link.connect();
    expect(probes).toEqual(['rtc://env-1']);
    expect(link.health()).toEqual({ ok: false, machine: 'studio', route: 'down' });
    expect(link.lastError()).toBe('No direct path to studio. Use the relay plan, or the Tailscale route in the README.');
    expect(noDirectPathMessage('studio')).toBe(link.lastError());
    link.stop();
  });

  it('reports the ChannelOpenError code of a refused direct probe (PAN-5069 A-7b)', async () => {
    const { link } = setup({
      relayRefusal: 'The relay needs the relay plan',
      probe: async () => {
        throw new ChannelOpenError('unknown-peer', 'unknown peer');
      },
    });
    await link.connect();
    expect(link.lastErrorCode()).toBe('unknown-peer');
    link.stop();
  });

  it('reports no code for a plain Error', async () => {
    const { link } = setup({
      relayRefusal: 'The relay needs the relay plan',
      probe: async () => {
        throw new Error('boom');
      },
    });
    await link.connect();
    expect(link.lastErrorCode()).toBeNull();
    link.stop();
  });

  it('keeps a machine refusal from either probe over a transport failure from the other', async () => {
    const relayRefused = setup({
      probe: async (url) => {
        throw url.startsWith('rtc://') ? new ChannelOpenError('unreachable', 'ICE failed') : new ChannelOpenError('unknown-peer', 'unknown peer');
      },
    });
    await relayRefused.link.connect();
    expect(relayRefused.link.lastErrorCode()).toBe('unknown-peer');
    relayRefused.link.stop();

    const directRefused = setup({
      probe: async (url) => {
        throw url.startsWith('rtc://') ? new ChannelOpenError('identity-refused', 'refused') : new ChannelOpenError('timeout', 'timed out');
      },
    });
    await directRefused.link.connect();
    expect(directRefused.link.lastErrorCode()).toBe('identity-refused');
    directRefused.link.stop();
  });

  it('clears the code after a later successful probe', async () => {
    let refuse = true;
    const { link } = setup({
      relayRefusal: 'The relay needs the relay plan',
      probe: async () => {
        if (refuse) throw new ChannelOpenError('unknown-peer', 'unknown peer');
        return fakeSocket();
      },
    });
    await link.connect();
    expect(link.lastErrorCode()).toBe('unknown-peer');
    refuse = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(link.lastErrorCode()).toBeNull();
    expect(link.health().ok).toBe(true);
    link.stop();
  });

  it('backs off 1 s, 2 s, 4 s up to 60 s and resets after a success', async () => {
    let succeed = false;
    const { link, probes, order } = setup({ relayRefusal: 'no relay', probe: async () => (succeed ? fakeSocket() : failing()) });
    await link.connect();
    expect(probes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(probes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(probes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(probes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(probes).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(probes).toHaveLength(4);
    // 8 s, 16 s, 32 s, then capped at 60 s.
    await vi.advanceTimersByTimeAsync(8_000 + 16_000 + 32_000);
    expect(probes).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(probes).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(1);
    expect(probes).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probes).toHaveLength(9);

    succeed = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(link.health().route).toBe('direct');
    succeed = false;
    link.markLost();
    await vi.advanceTimersByTimeAsync(0);
    const before = probes.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(probes.length).toBe(before + 1);

    // The first round does not close the transport; every later round closes it before probing.
    expect(order[0]).toBe('probe rtc://env-1');
    for (let i = 1; i < order.length; i += 2) {
      expect(order[i]).toBe('close');
      expect(order[i + 1]).toBe('probe rtc://env-1');
    }
    link.stop();
  });

  it('pauses while the directory shows the machine offline and probes at once when it returns', async () => {
    let succeed = true;
    const { link, directory, probes } = setup({ relayRefusal: 'no relay', probe: async () => (succeed ? fakeSocket() : failing()) });
    await link.connect();
    succeed = false;
    directory.update([{ ...MACHINE, online: false }]);
    expect(link.health().route).toBe('down');
    expect(link.lastError()).toBe('studio is offline in the overdeck.ai directory.');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(probes).toHaveLength(1);
    succeed = true;
    directory.update([MACHINE]);
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toHaveLength(2);
    expect(link.health().route).toBe('direct');
    link.stop();
  });

  it('waitOnline resolves true on success and false after the timeout', async () => {
    const { link } = setup({ relayRefusal: 'no relay', probe: failing });
    const late = link.waitOnline('env-1', 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await late).toBe(false);
    link.stop();

    const ok = setup();
    const waiting = ok.link.waitOnline('env-1', 10_000);
    await ok.link.connect();
    expect(await waiting).toBe(true);
    expect(await ok.link.waitOnline('env-1', 1)).toBe(true);
    expect(await ok.link.waitOnline('env-2', 1)).toBe(false);
    ok.link.stop();
  });

  it('gives the link key as the local key', async () => {
    const { link } = setup();
    const key = await link.localKey();
    expect(Buffer.from(key.publicKey).toString('hex')).toBe(IDENTITY.linkPublicKey);
    expect(Buffer.from(key.secretKey).toString('hex')).toBe(IDENTITY.linkSecretKey);
    link.stop();
  });
});

describe('createConnectorDashboardApi', () => {
  function apiWith(answer: (path: string, init: LinkFetchInit) => Promise<{ status: number; json: unknown }>) {
    const ctx = setup({ relayRefusal: 'no relay' });
    const calls: Array<{ env: string; path: string; init: LinkFetchInit }> = [];
    const api = createConnectorDashboardApi(ctx.link, {
      linkFetch: async (env, path, init = {}) => {
        calls.push({ env, path, init });
        return answer(path, init);
      },
    });
    return { ...ctx, api, calls };
  }

  it('sends DELETE without a body and POST with {} for an undefined body', async () => {
    const { api, calls, link } = apiWith(async () => ({ status: 200, json: { ok: true } }));
    await api.request('DELETE', '/api/connectors/self');
    await api.request('POST', '/api/fleet/conversations');
    await api.request('GET', '/api/conversations?limit=50');
    expect(calls.map((call) => [call.env, call.init.method, 'body' in call.init ? call.init.body : 'none'])).toEqual([
      ['env-1', 'DELETE', 'none'],
      ['env-1', 'POST', {}],
      ['env-1', 'GET', 'none'],
    ]);
    expect(calls[0]?.init.routeSource).toBe(link);
    link.stop();
  });

  it('maps a non-JSON body to null and keeps real JSON', async () => {
    const { api, link } = apiWith(async (path) =>
      path === '/text' ? { status: 502, json: { error: 'invalid-json', text: '<html>' } } : { status: 200, json: [{ name: 'conv-1' }] },
    );
    expect(await api.request('GET', '/text')).toEqual({ status: 502, json: null });
    expect(await api.request('GET', '/api/conversations')).toEqual({ status: 200, json: [{ name: 'conv-1' }] });
    link.stop();
  });

  it('marks the link lost and names the machine when a channel cannot open', async () => {
    let first = true;
    const ctx = apiWith(async () => {
      throw new ChannelOpenError('unreachable', 'data channel did not open');
    });
    ctx.openProbe.mockImplementation(async (url: TransportUrl) => {
      if (first) {
        first = false;
        return fakeSocket();
      }
      throw new ChannelOpenError('unreachable', `probe ${url} failed`);
    });
    await ctx.link.connect();
    expect(ctx.link.health().route).toBe('direct');
    await expect(ctx.api.request('GET', '/api/conversations')).rejects.toThrow(/^studio is unreachable: /);
    expect(ctx.link.health().route).toBe('down');
    expect(ctx.link.routeFor('env-1')?.state).toBe('connecting');
    ctx.link.stop();
  });
});
