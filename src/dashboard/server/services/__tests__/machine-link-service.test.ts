/**
 * PAN-4645 WI-12: createMachineLink with every dependency stubbed — the order
 * of operations, the reverse token's lifecycle, and the unsupported-peer refusal.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ChannelSocket } from '../../../../lib/anywhere/channel/channel-socket.js';
import { ChannelOpenError } from '../../../../lib/anywhere/channel/open.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { createMachineLink, MachineLinkError, type MachineLinkServiceDeps } from '../machine-link-service.js';

const PEER_KEY = 'b2'.repeat(32);
const OUR_KEY = { publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(32, 2) };
const PAIRING_URL = 'http://100.101.1.2:3011/#pair=odp_code';

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    descriptorVersion: 1,
    environmentId: 'env-peer',
    label: 'peer',
    platform: { os: 'linux', arch: 'x64' },
    serverVersion: '0.73.0',
    protocolVersion: 1,
    capabilities: { pairing: true, deviceSessions: true, terminalAuth: true, machineLinks: true },
    machineKey: PEER_KEY,
    linkProtocol: 1,
    endpoints: [{ kind: 'lan', url: 'tcp://192.168.1.20:3011' }],
    ...overrides,
  };
}

function fakeChannel(): ChannelSocket & { destroyed: boolean } {
  const channel = { channel: { mode: 'pairing', remoteKeyHex: PEER_KEY, pairingId: 'cd'.repeat(16) }, destroyed: false, destroy() { this.destroyed = true; } };
  return channel as unknown as ChannelSocket & { destroyed: boolean };
}

function harness(options: { descriptor?: Record<string, unknown>; exchange?: { status: number; json: unknown }; replaced?: MachineLink | null } = {}) {
  const calls: string[] = [];
  const channel = fakeChannel();
  const peer = options.descriptor ?? descriptor();
  const stored: MachineLink[] = [];
  const deps: MachineLinkServiceDeps = {
    openChannel: vi.fn(async () => { calls.push('openChannel'); return channel; }),
    channelRequest: vi.fn(async (_channel, method, path) => {
      calls.push(`${method} ${path}`);
      if (method === 'GET') return { status: 200, json: peer };
      return options.exchange ?? { status: 200, json: { v: 1, token: `odk_${'9'.repeat(64)}`, tokenId: 'peer-token', descriptor: peer, reverseLinkId: 'peer-link' } };
    }),
    ensureMachineKey: vi.fn(async () => { calls.push('ensureMachineKey'); return OUR_KEY; }),
    createAccessToken: vi.fn(async (input) => {
      calls.push('createAccessToken');
      return { token: `odk_${'1'.repeat(64)}`, record: { id: 'reverse-1', name: input.name, scopes: input.scopes, createdAt: 'now', lastUsedAt: null, kind: 'machine' as const, machineKey: input.machineKey, environmentId: input.environmentId, access: input.access } };
    }),
    revokeAccessToken: vi.fn(async (id: string) => { calls.push(`revoke ${id}`); return null; }),
    upsertLink: vi.fn(async (input) => {
      calls.push('upsertLink');
      const link: MachineLink = { id: 'link-1', ...input, reverseTokenId: input.reverseTokenId ?? null, createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null };
      stored.push(link);
      return { link, replaced: options.replaced ?? null };
    }),
    currentEndpoints: async () => [{ kind: 'lan', url: 'tcp://10.0.0.5:3011' }],
    localIdentity: async () => ({ environmentId: 'env-us', label: 'us' }),
    now: () => '2026-11-01T00:00:00.000Z',
  };
  return { deps, calls, channel, stored };
}

describe('createMachineLink (PAN-4645 WI-12)', () => {
  it('ac3: opens the channel before minting the reverse token and writes one link with a pairing route first', async () => {
    const { deps, calls, channel, stored } = harness();
    const { link, view, peer } = await createMachineLink({ pairingUrl: PAIRING_URL }, deps);

    expect(calls).toEqual(['ensureMachineKey', 'openChannel', 'GET /api/environment', 'createAccessToken', 'POST /api/machines/exchange', 'upsertLink']);
    expect(calls.indexOf('openChannel')).toBeLessThan(calls.indexOf('createAccessToken'));
    expect(vi.mocked(deps.openChannel).mock.calls[0]![0]).toBe('tcp://100.101.1.2:3011');
    expect(vi.mocked(deps.openChannel).mock.calls[0]![1]).toMatchObject({ mode: 'pairing', pairingCode: 'odp_code', localKey: OUR_KEY });
    expect(vi.mocked(deps.createAccessToken).mock.calls[0]![0]).toMatchObject({ kind: 'machine', machineKey: PEER_KEY, environmentId: 'env-peer', access: 'operator', name: 'machine:peer' });
    const exchangeBody = vi.mocked(deps.channelRequest).mock.calls[1]![3] as { reverse: { token: string; endpoints: unknown[] } };
    expect(exchangeBody).toMatchObject({ v: 1, environmentId: 'env-us', label: 'us', access: 'operator' });
    expect(exchangeBody.reverse.token).toBe(`odk_${'1'.repeat(64)}`);
    expect(exchangeBody.reverse.endpoints).toEqual([{ kind: 'lan', url: 'tcp://10.0.0.5:3011' }]);

    expect(stored).toHaveLength(1);
    expect(link).toMatchObject({ environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator', reverseTokenId: 'reverse-1' });
    expect(link.routes[0]).toEqual({ url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' });
    expect(link.routes[1]).toMatchObject({ url: 'tcp://192.168.1.20:3011', kind: 'lan', source: 'advertised' });
    expect(view).toMatchObject({ id: 'link-1', state: 'connecting', peerVersion: '0.73.0', access: 'operator' });
    expect(view.fingerprint).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/);
    expect(JSON.stringify(view)).not.toContain('odk_');
    expect(peer.environmentId).toBe('env-peer');
    expect(channel.destroyed).toBe(true);
  });

  it('bothWays false mints no token and sends reverse: null', async () => {
    const { deps, calls } = harness();
    const { link } = await createMachineLink({ pairingUrl: PAIRING_URL, bothWays: false, access: 'agent-fenced' }, deps);
    expect(calls).not.toContain('createAccessToken');
    expect((vi.mocked(deps.channelRequest).mock.calls[1]![3] as { reverse: unknown; access: string })).toMatchObject({ reverse: null, access: 'agent-fenced' });
    expect(link.reverseTokenId).toBeNull();
    expect(link.access).toBe('agent-fenced');
  });

  it('ac4: an exchange failure revokes the minted reverse token and returns the error', async () => {
    const { deps, calls, channel, stored } = harness({ exchange: { status: 403, json: { error: 'machine exchange is accepted only inside a pairing channel' } } });
    await expect(createMachineLink({ pairingUrl: PAIRING_URL }, deps)).rejects.toMatchObject({ code: 'exchange-failed' });
    expect(calls).toContain('createAccessToken');
    expect(calls).toContain('revoke reverse-1');
    expect(calls).not.toContain('upsertLink');
    expect(stored).toEqual([]);
    expect(channel.destroyed).toBe(true);
  });

  it('ac5: a descriptor without capabilities.machineLinks is refused with unsupported before anything is minted or written', async () => {
    const { deps, calls } = harness({ descriptor: descriptor({ capabilities: { pairing: true, deviceSessions: true, terminalAuth: true }, linkProtocol: undefined }) });
    const error = await createMachineLink({ pairingUrl: PAIRING_URL }, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MachineLinkError);
    expect((error as MachineLinkError).code).toBe('unsupported');
    expect((error as MachineLinkError).message).toContain('0.73.0');
    expect(calls).toEqual(['ensureMachineKey', 'openChannel', 'GET /api/environment']);

    const wrongProtocol = harness({ descriptor: descriptor({ linkProtocol: 2 }) });
    await expect(createMachineLink({ pairingUrl: PAIRING_URL }, wrongProtocol.deps)).rejects.toMatchObject({ code: 'unsupported' });
    expect(wrongProtocol.calls).not.toContain('createAccessToken');
  });

  it('maps channel-open failures, refuses a key mismatch, and revokes a replaced link\'s reverse token', async () => {
    const refused = harness();
    refused.deps.openChannel = vi.fn(async () => { throw new ChannelOpenError('pairing-refused', 'nope'); });
    await expect(createMachineLink({ pairingUrl: PAIRING_URL }, refused.deps)).rejects.toMatchObject({ code: 'pairing-refused' });
    const down = harness();
    down.deps.openChannel = vi.fn(async () => { throw new ChannelOpenError('unreachable', 'ECONNREFUSED'); });
    await expect(createMachineLink({ pairingUrl: PAIRING_URL }, down.deps)).rejects.toMatchObject({ code: 'unreachable' });
    await expect(createMachineLink({ pairingUrl: 'http://localhost:3011/#pair=odp_x' }, harness().deps)).rejects.toMatchObject({ code: 'bad-pairing-url' });

    const mismatch = harness({ descriptor: descriptor({ machineKey: 'c3'.repeat(32) }) });
    await expect(createMachineLink({ pairingUrl: PAIRING_URL }, mismatch.deps)).rejects.toMatchObject({ code: 'identity-mismatch' });
    expect(mismatch.calls).not.toContain('createAccessToken');

    const old: MachineLink = { id: 'old', environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: 'odk_old', access: 'operator', reverseTokenId: 'reverse-old', routes: [], createdAt: 'then', revokedAt: null };
    const replaced = harness({ replaced: old });
    await createMachineLink({ pairingUrl: PAIRING_URL }, replaced.deps);
    expect(replaced.calls).toContain('revoke reverse-old');
    expect(replaced.calls).not.toContain('revoke reverse-1');
  });

  it('PAN-4404: a prepared ssh transport opens the channel on that URL and stores a first route of kind ssh', async () => {
    const { deps, calls, stored } = harness();
    const { link } = await createMachineLink({ transport: { url: 'tcp://127.0.0.1:41234', kind: 'ssh', pairingCode: 'odp_x' } }, deps);
    expect(calls[1]).toBe('openChannel');
    expect(vi.mocked(deps.openChannel).mock.calls[0]![0]).toBe('tcp://127.0.0.1:41234');
    expect(vi.mocked(deps.openChannel).mock.calls[0]![1]).toMatchObject({ mode: 'pairing', pairingCode: 'odp_x' });
    expect(stored).toHaveLength(1);
    expect(link.routes[0]).toEqual({ url: 'tcp://127.0.0.1:41234', kind: 'ssh', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' });
  });

  it('PAN-4404: a transport without an odp_ code, or no pairing link and no transport, is bad-pairing-url', async () => {
    const { deps, calls } = harness();
    await expect(createMachineLink({ transport: { url: 'tcp://127.0.0.1:41234', kind: 'ssh', pairingCode: 'nope' } }, deps)).rejects.toMatchObject({ code: 'bad-pairing-url' });
    await expect(createMachineLink({}, deps)).rejects.toMatchObject({ code: 'bad-pairing-url' });
    expect(calls).toEqual([]);
  });
});
