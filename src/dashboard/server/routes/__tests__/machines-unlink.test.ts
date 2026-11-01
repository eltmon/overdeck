/**
 * PAN-4645 WI-13: GET /api/machines lists links and inbound tokens with no
 * secret; unlink with the peer offline removes the link and revokes the
 * reverse token; DELETE /api/machines/self takes exactly a machine credential;
 * removing an inbound token closes that peer's channel sockets.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, listActiveRecordsOfKind, MACHINE_TOKEN_SCOPES, verifyAccessToken } = await import('../../../../lib/access-tokens.js');
const { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, listLinks, upsertLink } = await import('../../../../lib/anywhere/link-store.js');
const { openChannel } = await import('../../../../lib/anywhere/channel/open.js');
const { _resetChannelListenerForTests, installChannelListener, liveChannelCount } = await import('../../channel-listener.js');
const { buildMachinesResponse, handleAddRoute, handleInboundRevoke, handleMachinesSelfRevoke, handleMachinesUnlink } = await import('../machines.js');
const { resolveDashboardCredential } = await import('../dashboard-auth.js');
type MachineKeyPair = import('../../../../lib/anywhere/machine-key.js').MachineKeyPair;

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };
const PEER_KEY = 'b2'.repeat(32);
const originalHome = process.env.OVERDECK_HOME;
let home: string;
const cleanups: Array<() => Promise<void> | void> = [];

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

async function reverseToken(key = PEER_KEY, environmentId = 'env-peer') {
  return createAccessToken({
    name: 'machine:peer', kind: 'machine', scopes: MACHINE_TOKEN_SCOPES('operator'),
    machineKey: key, environmentId, access: 'operator',
  });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-machines-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = 'machines-internal-token';
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  _resetChannelListenerForTests();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await _settleAccessTokenWritesForTests();
  await _settleLinkStoreWritesForTests();
  _resetAccessTokensForTests();
  _resetLinkStoreForTests();
  _resetChannelListenerForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('machine link routes (PAN-4645 WI-13)', () => {
  it('ac1: lists self, links and inbound tokens without any token or tokenHash field', async () => {
    const { record } = await reverseToken();
    await upsertLink({
      environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
      reverseTokenId: record.id,
      routes: [{ url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' }],
    });
    const response = await buildMachinesResponse();
    expect(response.self.environmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.self.fingerprint).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/);
    expect(response.links).toHaveLength(1);
    expect(response.links[0]).toMatchObject({ environmentId: 'env-peer', label: 'peer', access: 'operator', state: 'connecting', peerVersion: null });
    expect(response.links[0]!.routes).toEqual([{ url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', status: 'untried' }]);
    expect(response.inbound).toEqual([{
      tokenId: record.id, environmentId: 'env-peer', label: 'peer', fingerprint: response.links[0]!.fingerprint,
      access: 'operator', createdAt: record.createdAt, lastUsedAt: null,
    }]);
    const text = JSON.stringify(response);
    expect(text).not.toContain('"token"');
    expect(text).not.toContain('tokenHash');
    expect(text).not.toContain('odk_');
  });

  it('ac2: unlinking with the peer unreachable removes the link, revokes the reverse token and reports peerNotified false', async () => {
    const { token: reverse, record } = await reverseToken();
    const { link } = await upsertLink({
      environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
      reverseTokenId: record.id, routes: [],
    });
    const { status, json } = await read(await handleMachinesUnlink(link.id, async () => { throw new Error('ECONNREFUSED'); }));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, peerNotified: false });
    expect(await listLinks()).toEqual([]);
    expect(verifyAccessToken(reverse)).toEqual({ ok: false });

    expect((await read(await handleMachinesUnlink(link.id))).status).toBe(404);

    // By label, with a peer that answers.
    await upsertLink({ environmentId: 'env-lab', label: 'lab', machineKey: 'c3'.repeat(32), token: `odk_${'8'.repeat(64)}`, access: 'agent-fenced', reverseTokenId: null, routes: [] });
    const byLabel = await read(await handleMachinesUnlink('lab', async () => true));
    expect(byLabel.json).toEqual({ ok: true, peerNotified: true });
    expect(await listLinks()).toEqual([]);
  });

  it('ac3: self-revoke needs a machine credential; with one it revokes that token', async () => {
    const device = await createAccessToken({ name: 'phone', kind: 'device', scopes: ['admin'] });
    const asDevice = resolveDashboardCredential({ authorization: `Bearer ${device.token}` });
    expect((await read(await handleMachinesSelfRevoke(asDevice))).status).toBe(403);
    expect((await read(await handleMachinesSelfRevoke({ kind: 'root-session' }))).status).toBe(403);
    expect((await read(await handleMachinesSelfRevoke(null))).status).toBe(403);

    const { token } = await reverseToken();
    const asMachine = resolveDashboardCredential({ authorization: `Bearer ${token}` }, { mode: 'link', remoteKeyHex: PEER_KEY, pairingId: null });
    expect(asMachine?.kind).toBe('machine');
    expect((await read(await handleMachinesSelfRevoke(asMachine))).json).toEqual({ ok: true });
    expect(verifyAccessToken(token)).toEqual({ ok: false });
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
  });

  it('ac4: removing an inbound token closes that peer\'s channel sockets', async () => {
    const serverKey = dh.generateKeyPair();
    const peerKey = dh.generateKeyPair();
    const peerHex = peerKey.publicKey.toString('hex');
    const { record } = await reverseToken(peerHex, 'env-live');
    const http = createServer((_req, res) => res.end('ok'));
    installChannelListener(http, {
      primary: true,
      localKey: async () => serverKey,
      isPinnedPeer: (key) => key === peerHex,
      takePairing: () => 'unknown',
      onPairingFailure: () => undefined,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const port = (http.address() as { port: number }).port;
    const channel = await openChannel(`tcp://127.0.0.1:${port}`, { mode: 'link', localKey: peerKey, remoteKeyHex: serverKey.publicKey.toString('hex') });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);
    const closed = new Promise<void>((resolve) => channel.once('close', resolve));

    const { status, json } = await read(await handleInboundRevoke(record.id));
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, closedChannels: 1, inbound: { tokenId: record.id, environmentId: 'env-live' } });
    await closed;
    expect(liveChannelCount()).toBe(0);
    expect(listActiveRecordsOfKind('machine')).toEqual([]);
    expect((await read(await handleInboundRevoke(record.id))).status).toBe(404);
  });
});

describe('POST /api/machines/:id/routes (PAN-4645 WI-19 Add route)', () => {
  it('adds a validated manual route once, refusing bad URLs and duplicates', async () => {
    const { link } = await upsertLink({
      environmentId: 'env-peer', label: 'peer', machineKey: PEER_KEY, token: `odk_${'9'.repeat(64)}`, access: 'operator',
      reverseTokenId: null,
      routes: [{ url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' }],
    });
    const added = await read(await handleAddRoute('peer', JSON.stringify({ url: 'tcp://192.168.1.5:3011' })));
    expect(added.status).toBe(200);
    expect((added.json as { routes: Array<Record<string, unknown>> }).routes.map((route) => [route.url, route.kind, route.source])).toEqual([
      ['tcp://100.101.1.2:3011', 'tailnet', 'pairing'],
      ['tcp://192.168.1.5:3011', 'lan', 'manual'],
    ]);
    expect((await listLinks()).find((row) => row.id === link.id)?.routes.map((route) => route.url)).toEqual(['tcp://100.101.1.2:3011', 'tcp://192.168.1.5:3011']);

    expect((await read(await handleAddRoute(link.id, JSON.stringify({ url: 'tcp://192.168.1.5:3011' })))).status).toBe(409);
    expect((await read(await handleAddRoute(link.id, JSON.stringify({ url: 'http://192.168.1.5:3011' })))).status).toBe(400);
    expect((await read(await handleAddRoute(link.id, JSON.stringify({ url: 'tcp://192.168.1.6' })))).status).toBe(400);
    expect((await read(await handleAddRoute(link.id, '{'))).status).toBe(400);
    expect((await read(await handleAddRoute('nobody', JSON.stringify({ url: 'tcp://192.168.1.6:3011' })))).status).toBe(404);
  });
});
