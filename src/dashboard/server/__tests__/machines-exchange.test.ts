/**
 * PAN-4645 WI-12: POST /api/machines/exchange mints the machine token bound to
 * the pairing channel's remote key, writes the reverse link, refuses plain
 * sockets and link channels, and replaces a previous token for the same
 * environment. Also: a pairing credential yields its PSK by pairing id once.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, listActiveRecordsOfKind, MACHINE_TOKEN_SCOPES, verifyAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, listLinks } = await import('../../../lib/anywhere/link-store.js');
const { pairingSecrets } = await import('@overdeck/anywhere-channel');
const { nodeCrypto } = await import('@overdeck/anywhere-channel/node');
const { _resetPairingCredentialsForTests, consumePairingCredential, issuePairingCredential, takePairingById } = await import('../pairing-credentials.js');
const { handleMachinesExchange } = await import('../routes/machines-peer.js');
type ChannelMarker = import('../channel-peer.js').ChannelMarker;

const KEY_A = 'a1'.repeat(32);
const PAIRING: ChannelMarker = { mode: 'pairing', remoteKeyHex: KEY_A, pairingId: 'cd'.repeat(16) };
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY_A, pairingId: null };
const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    environmentId: 'env-desk',
    label: 'desk',
    access: 'operator',
    reverse: { token: `odk_${'f'.repeat(64)}`, endpoints: [{ kind: 'lan', url: 'tcp://192.168.1.20:3011' }] },
    ...overrides,
  });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-exchange-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'exchange-internal-token';
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  _resetPairingCredentialsForTests();
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  await _settleLinkStoreWritesForTests();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  _resetPairingCredentialsForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/machines/exchange (PAN-4645 WI-12)', () => {
  it('ac1: mints a machine token bound to the channel key with the FR-7 scopes and writes the reverse link', async () => {
    const { status, json } = await read(await handleMachinesExchange(body(), PAIRING));
    expect(status).toBe(200);
    expect(json.v).toBe(1);
    expect(json.token).toMatch(/^odk_/);
    const verified = verifyAccessToken(json.token as string);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.record).toMatchObject({
      id: json.tokenId, kind: 'machine', machineKey: KEY_A, environmentId: 'env-desk', access: 'operator', name: 'machine:desk',
    });
    expect(verified.record.scopes).toEqual(MACHINE_TOKEN_SCOPES('operator'));
    expect((json.descriptor as { capabilities: { machineLinks: boolean } }).capabilities.machineLinks).toBe(true);

    const links = await listLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: json.reverseLinkId, environmentId: 'env-desk', label: 'desk', machineKey: KEY_A, token: `odk_${'f'.repeat(64)}`, reverseTokenId: json.tokenId });
    expect(links[0]!.routes).toEqual([expect.objectContaining({ url: 'tcp://192.168.1.20:3011', kind: 'lan', source: 'advertised' })]);
    const file = JSON.parse(await readFile(join(home, 'machine-links.json'), 'utf8')) as { links: unknown[] };
    expect(file.links).toHaveLength(1);
  });

  it('ac2: without a pairing channel marker the route answers 403, link channels included', async () => {
    expect((await read(await handleMachinesExchange(body(), null))).status).toBe(403);
    expect((await read(await handleMachinesExchange(body(), LINK))).status).toBe(403);
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
    expect(await listLinks()).toEqual([]);
  });

  it('a second exchange for the same environment revokes the first token; no reverse means no link', async () => {
    const first = await read(await handleMachinesExchange(body({ reverse: null }), PAIRING));
    expect(first.status).toBe(200);
    expect(first.json.reverseLinkId).toBeNull();
    expect(await listLinks()).toEqual([]);

    const second = await read(await handleMachinesExchange(body({ reverse: null, access: 'agent-fenced' }), PAIRING));
    expect(second.status).toBe(200);
    expect(verifyAccessToken(first.json.token as string)).toEqual({ ok: false });
    const active = listActiveRecordsOfKind('machine');
    expect(active.map((record) => record.id)).toEqual([second.json.tokenId]);
    expect(active[0]!.scopes).toEqual(MACHINE_TOKEN_SCOPES('agent-fenced'));
    expect(active[0]!.scopes).not.toContain('forward');
  });

  it('rejects malformed bodies without minting', async () => {
    expect((await read(await handleMachinesExchange('nope', PAIRING))).status).toBe(400);
    expect((await read(await handleMachinesExchange(body({ v: 2 }), PAIRING))).status).toBe(400);
    expect((await read(await handleMachinesExchange(body({ access: 'root' }), PAIRING))).status).toBe(400);
    expect((await read(await handleMachinesExchange(body({ reverse: { token: 'nope', endpoints: [] } }), PAIRING))).status).toBe(400);
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
  });
});

describe('pairing credentials by pairing id (D-4645-17)', () => {
  it('yields the PSK for a live credential once, then unknown; the device exchange consumes it too', () => {
    const { credential } = issuePairingCredential();
    const { psk, pairingId } = pairingSecrets(nodeCrypto, credential);
    const taken = takePairingById(pairingId);
    expect(taken).not.toBe('unknown');
    expect((taken as { psk: Buffer }).psk.equals(psk)).toBe(true);
    expect(takePairingById(pairingId)).toBe('unknown');
    expect(consumePairingCredential(credential)).toBe('unknown');

    const second = issuePairingCredential();
    expect(consumePairingCredential(second.credential)).toBe('ok');
    expect(takePairingById(pairingSecrets(nodeCrypto, second.credential).pairingId)).toBe('unknown');
    expect(takePairingById('00'.repeat(16))).toBe('unknown');
  });

  it('answers expired for a credential past its TTL', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
      const { credential } = issuePairingCredential();
      vi.setSystemTime(new Date('2026-11-01T12:11:00.000Z'));
      expect(takePairingById(pairingSecrets(nodeCrypto, credential).pairingId)).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
