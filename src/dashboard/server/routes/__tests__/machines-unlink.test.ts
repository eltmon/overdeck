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

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

// PAN-4404 WI-9: the SSH side of a link is the service's job; these tests see only its calls.
const sshMocks = vi.hoisted(() => ({
  removeSshMachineForLink: vi.fn(async () => null as unknown),
  sshInfoForLink: vi.fn(async () => undefined as unknown),
  reconnectSshMachine: vi.fn(async () => null as unknown),
}));
vi.mock('../../services/ssh-machine-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/ssh-machine-service.js')>()),
  removeSshMachineForLink: sshMocks.removeSshMachineForLink,
  sshInfoForLink: sshMocks.sshInfoForLink,
  reconnectSshMachine: sshMocks.reconnectSshMachine,
}));
// PAN-4652 WI-8: the Fly VM itself is never touched; these tests see only the destroy call.
const flyMocks = vi.hoisted(() => ({ destroyFlyVm: vi.fn(async () => undefined) }));
vi.mock('../../../../lib/anywhere/fly/provision.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/anywhere/fly/provision.js')>()),
  destroyFlyVm: flyMocks.destroyFlyVm,
}));
vi.mock('../dashboard-auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../dashboard-auth.js')>()),
  rejectUnauthorizedDashboardRequest: () => null,
  rejectUnsafeDashboardMutationRequest: () => null,
}));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, listActiveRecordsOfKind, MACHINE_TOKEN_SCOPES, verifyAccessToken } = await import('../../../../lib/access-tokens.js');
const { _resetLinkStoreForTests, _settleLinkStoreWritesForTests, listLinks, upsertLink } = await import('../../../../lib/anywhere/link-store.js');
const { openChannel } = await import('../../../../lib/anywhere/channel/open.js');
const { _resetChannelListenerForTests, installChannelListener, liveChannelCount } = await import('../../channel-listener.js');
const { buildMachinesResponse, handleAddRoute, handleInboundRevoke, handleMachinesSelfRevoke, handleMachinesUnlink, machinesRouteLayer } = await import('../machines.js');
const { resolveDashboardCredential } = await import('../dashboard-auth.js');
const { _resetFlyMachineStoreForTests, _settleFlyMachineWritesForTests, listFlyMachines, upsertFlyMachine } = await import('../../../../lib/anywhere/fly/machine-store.js');
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
    expect(json).toEqual({ ok: true, peerNotified: false, ssh: null, fly: null });
    expect(await listLinks()).toEqual([]);
    expect(verifyAccessToken(reverse)).toEqual({ ok: false });

    expect((await read(await handleMachinesUnlink(link.id))).status).toBe(404);

    // By label, with a peer that answers.
    await upsertLink({ environmentId: 'env-lab', label: 'lab', machineKey: 'c3'.repeat(32), token: `odk_${'8'.repeat(64)}`, access: 'agent-fenced', reverseTokenId: null, routes: [] });
    const byLabel = await read(await handleMachinesUnlink('lab', async () => true));
    expect(byLabel.json).toEqual({ ok: true, peerNotified: true, ssh: null, fly: null });
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

describe('SSH-backed links (PAN-4404 WI-9)', () => {
  const SSH_INFO = { destination: 'me@desk', launch: 'managed', forward: 'up', forwardDetail: null, localPort: 41234, remotePort: 3011 } as const;

  async function sshLink(label = 'desk', environmentId = 'env-desk', key = 'd4'.repeat(32)) {
    const { link } = await upsertLink({
      environmentId, label, machineKey: key, token: `odk_${'7'.repeat(64)}`, access: 'operator', reverseTokenId: null,
      routes: [{ url: 'tcp://127.0.0.1:41234', kind: 'ssh', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' }],
    });
    return link;
  }

  async function route(method: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, { method }));
    const response = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(HttpRouter.toHttpEffect(machinesRouteLayer), (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req))),
    );
    return read(response);
  }

  beforeEach(() => {
    sshMocks.removeSshMachineForLink.mockReset().mockResolvedValue(null);
    sshMocks.sshInfoForLink.mockReset().mockResolvedValue(undefined);
  });

  it('unlink of a managed SSH link runs the SSH removal with keepServer false before removing the link', async () => {
    const link = await sshLink();
    sshMocks.removeSshMachineForLink.mockImplementation(async () => {
      // The link still exists while the SSH side is torn down.
      expect((await listLinks()).map((l) => l.id)).toEqual([link.id]);
      return { stopped: true, reason: 'stopped' };
    });
    const { status, json } = await read(await handleMachinesUnlink(link.id, async () => true));
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, peerNotified: true, ssh: { stopped: true, reason: 'stopped' }, fly: null });
    expect(sshMocks.removeSshMachineForLink).toHaveBeenCalledWith(expect.objectContaining({ id: link.id }), { keepServer: false });
    expect(await listLinks()).toEqual([]);
  });

  it('DELETE /api/machines/:id?keepServer=1 passes keepServer true to the SSH removal', async () => {
    const link = await sshLink();
    sshMocks.removeSshMachineForLink.mockResolvedValue({ stopped: false, reason: 'kept' });
    const { status, json } = await route('DELETE', `/api/machines/${link.id}?keepServer=1`);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, ssh: { stopped: false, reason: 'kept' } });
    expect(sshMocks.removeSshMachineForLink).toHaveBeenCalledWith(expect.objectContaining({ id: link.id }), { keepServer: true });
  });

  it('GET /api/machines carries the ssh block only for SSH-backed links', async () => {
    const ssh = await sshLink();
    await upsertLink({ environmentId: 'env-plain', label: 'plain', machineKey: 'e5'.repeat(32), token: `odk_${'6'.repeat(64)}`, access: 'operator', reverseTokenId: null, routes: [] });
    sshMocks.sshInfoForLink.mockImplementation(async (linkId: unknown) => (linkId === ssh.id ? SSH_INFO : undefined));
    const response = await buildMachinesResponse();
    const byLabel = Object.fromEntries(response.links.map((l) => [l.label, l]));
    expect(byLabel['desk']!.ssh).toEqual(SSH_INFO);
    expect('ssh' in byLabel['plain']!).toBe(false);
  });
});

describe('Fly machine unlink (PAN-4652 WI-8)', () => {
  async function route(method: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, { method }));
    const response = await Effect.runPromise(
      Effect.scoped(Effect.flatMap(HttpRouter.toHttpEffect(machinesRouteLayer), (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req))),
    );
    return read(response);
  }

  async function flyLink() {
    const { link } = await upsertLink({
      environmentId: '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f', label: 'fly-148e21ea7e1689', machineKey: 'f6'.repeat(32), token: `odk_${'5'.repeat(64)}`,
      access: 'operator', reverseTokenId: null,
      routes: [{ url: 'wss://overdeck-ws.fly.dev/ws/link?fly-instance=148e21ea7e1689', kind: 'public', source: 'pairing', addedAt: '2026-11-01T00:00:00.000Z' }],
    });
    await upsertFlyMachine({
      id: 'rec-1', linkId: link.id, environmentId: link.environmentId, machineId: '148e21ea7e1689', machineName: 'overdeck-machine-1a2b3c4d',
      appName: 'overdeck-ws', region: 'iad', label: 'fly-148e21ea7e1689', projectKey: null, docker: true, createdAt: '2026-11-01T00:00:00.000Z',
    });
    return link;
  }

  beforeEach(() => {
    flyMocks.destroyFlyVm.mockReset().mockResolvedValue(undefined);
    _resetFlyMachineStoreForTests();
  });

  afterEach(async () => {
    await _settleFlyMachineWritesForTests();
  });

  it('DELETE /api/machines/:id destroys the Fly machine and deletes its record', async () => {
    const link = await flyLink();
    const { status, json } = await route('DELETE', `/api/machines/${link.id}`);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, ssh: null, fly: { destroyed: true } });
    expect(flyMocks.destroyFlyVm).toHaveBeenCalledWith('overdeck-ws', '148e21ea7e1689');
    expect(await listFlyMachines()).toEqual([]);
    expect(await listLinks()).toEqual([]);
  });

  it('DELETE /api/machines/:id?keepServer=1 leaves the Fly machine running and still deletes the record', async () => {
    const link = await flyLink();
    const { status, json } = await route('DELETE', `/api/machines/${link.id}?keepServer=1`);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, fly: { destroyed: false } });
    expect(flyMocks.destroyFlyVm).not.toHaveBeenCalled();
    expect(await listFlyMachines()).toEqual([]);
  });

  it('keeps the link and record and answers 502 when the destroy fails', async () => {
    const link = await flyLink();
    flyMocks.destroyFlyVm.mockRejectedValue(new Error('Fly API error 500'));
    const { status, json } = await route('DELETE', `/api/machines/${link.id}`);
    expect(status).toBe(502);
    expect(json).toMatchObject({ error: 'unreachable' });
    expect(await listFlyMachines()).toHaveLength(1);
    expect((await listLinks()).map((l) => l.id)).toEqual([link.id]);
  });
});
