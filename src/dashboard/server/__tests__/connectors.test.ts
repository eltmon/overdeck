/**
 * PAN-4949 W-5: the connector operator routes — root-only pairing, list and
 * revoke, and the connector's own self-revoke. Revoking closes the
 * connector's live channels at once.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { pairingSecrets } = await import('@overdeck/anywhere-channel');
const { nodeCrypto } = await import('@overdeck/anywhere-channel/node');
const { parseConnectorPairLink } = await import('@overdeck/contracts');
const {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  BOT_DEFAULT_SCOPES,
  createAccessToken,
  PHONE_TOKEN_SCOPES,
  revokeAccessToken,
  listAccessTokens,
  listActiveRecordsOfKind,
  verifyAccessToken,
} = await import('../../../lib/access-tokens.js');
const { openChannel } = await import('../../../lib/anywhere/channel/open.js');
const { _resetChannelListenerForTests, installChannelListener, liveChannelCount } = await import('../channel-listener.js');
const { _resetConnectorPairingForTests, takeConnectorIntent } = await import('../connector-pairing.js');
const { _resetPairingCredentialsForTests, issuePairingCredential } = await import('../pairing-credentials.js');
const { remoteGateRejection } = await import('../remote-request-gate.js');
const { resolveDashboardCredential } = await import('../routes/dashboard-auth.js');
const { connectorsRouteLayer, handleConnectorList, handleConnectorsExchange, handleConnectorPairing, handleConnectorRevoke, handleConnectorSelfRevoke } = await import('../routes/connectors.js');
type MachineKeyPair = import('../../../lib/anywhere/machine-key.js').MachineKeyPair;
type ChannelMarker = import('../channel-peer.js').ChannelMarker;

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const CONNECTOR_KEY = 'c1'.repeat(32);
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const originalHome = process.env.OVERDECK_HOME;
let home: string;
const cleanups: Array<() => Promise<void> | void> = [];

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown>; cacheControl: string | null }> {
  const web = HttpServerResponse.toWeb(response);
  return { status: response.status, cacheControl: web.headers.get('cache-control'), json: JSON.parse(await web.text()) as Record<string, unknown> };
}

/** Pair through the route as root and return the intent stored for the issued code. */
async function pairedIntent(body: Record<string, unknown>) {
  const { status, json } = await read(await handleConnectorPairing('internal-token', JSON.stringify(body)));
  expect(status).toBe(200);
  const code = parseConnectorPairLink(json.pairingString as string)!.code;
  return takeConnectorIntent(pairingSecrets(nodeCrypto, code).pairingId);
}

async function mintConnector(connectorKey = CONNECTOR_KEY, clientId = CLIENT_ID) {
  return createAccessToken({ name: 'bot:desk', kind: 'connector', scopes: ['read:state', 'tell'], connectorKey, clientId });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4949-connectors-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
  _resetPairingCredentialsForTests();
  _resetConnectorPairingForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/connectors/pairing (PAN-4949 D-11, D-12, D-14)', () => {
  it('issues a parseable pairing string to the internal token, with no-store', async () => {
    const { status, json, cacheControl } = await read(await handleConnectorPairing('internal-token', JSON.stringify({ name: 'bot:desk' })));
    expect(status).toBe(200);
    expect(parseConnectorPairLink(json.pairingString as string)).not.toBeNull();
    expect(typeof json.expiresAt).toBe('string');
    expect(cacheControl).toBe('no-store');
  });

  it('refuses a device and an admin token credential kind with 403', async () => {
    expect((await read(await handleConnectorPairing('device', JSON.stringify({ name: 'bot' })))).status).toBe(403);
    expect((await read(await handleConnectorPairing('token', JSON.stringify({ name: 'bot' })))).status).toBe(403);
  });

  it('refuses admin and forward scopes and a 65-character name with 400', async () => {
    expect((await read(await handleConnectorPairing('internal-token', JSON.stringify({ name: 'bot', scopes: ['admin'] })))).status).toBe(400);
    expect((await read(await handleConnectorPairing('internal-token', JSON.stringify({ name: 'bot', scopes: ['forward'] })))).status).toBe(400);
    expect((await read(await handleConnectorPairing('internal-token', JSON.stringify({ name: 'x'.repeat(65) })))).status).toBe(400);
  });

  it('stores the bot defaults without scopes, and always adds read:state', async () => {
    expect((await pairedIntent({ name: 'bot:defaults' }))?.scopes).toEqual([...BOT_DEFAULT_SCOPES]);
    expect((await pairedIntent({ name: 'bot:tell', scopes: ['tell'] }))?.scopes).toEqual(['read:state', 'tell']);
  });
});

describe('GET /api/connectors (PAN-4949 D-15)', () => {
  it('lists active connectors without key material or hashes', async () => {
    const { record } = await mintConnector();
    const { record: gone } = await mintConnector('c2'.repeat(32), '44444444-4444-4444-8444-444444444444');
    await revokeAccessToken(gone.id);
    const { status, json } = await read(await handleConnectorList('root-session'));
    expect(status).toBe(200);
    const connectors = json.connectors as Array<Record<string, unknown>>;
    expect(connectors).toHaveLength(1);
    expect(Object.keys(connectors[0]!).sort()).toEqual(['clientId', 'createdAt', 'id', 'lastUsedAt', 'name', 'scopes']);
    expect(connectors[0]).toMatchObject({ id: record.id, clientId: CLIENT_ID, scopes: ['read:state', 'tell'] });
  });

  it('refuses a non-root credential kind', async () => {
    expect((await read(await handleConnectorList('device'))).status).toBe(403);
  });
});

describe('DELETE /api/connectors/:id and /self (PAN-4949 D-13, D-16)', () => {
  it('revokes by id and closes the connector live channel at once', async () => {
    const serverKey = dh.generateKeyPair();
    const connectorKey = dh.generateKeyPair();
    const connectorHex = connectorKey.publicKey.toString('hex');
    const { token, record } = await mintConnector(connectorHex);

    const http = createServer((_req, res) => res.end('ok'));
    installChannelListener(http, {
      primary: true,
      localKey: async () => serverKey,
      isPinnedPeer: (key) => key === connectorHex,
      takePairing: () => 'unknown',
      onPairingFailure: () => undefined,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const channelPort = (http.address() as { port: number }).port;
    const channel = await openChannel(`tcp://127.0.0.1:${channelPort}`, { mode: 'link', localKey: connectorKey, remoteKeyHex: serverKey.publicKey.toString('hex') });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);

    const { json } = await read(await handleConnectorRevoke('internal-token', record.id));
    expect(json).toEqual({ ok: true });
    expect(liveChannelCount()).toBe(0);
    expect(verifyAccessToken(token)).toEqual({ ok: false });
  });

  it('answers 404 for an unknown id and 403 for a token credential kind', async () => {
    const { record } = await mintConnector();
    expect((await read(await handleConnectorRevoke('internal-token', 'no-such-id'))).status).toBe(404);
    expect((await read(await handleConnectorRevoke('token', record.id))).status).toBe(403);
  });

  it('lets a connector revoke itself and refuses a phone credential', async () => {
    const { token } = await mintConnector();
    const phone = await createAccessToken({
      name: 'phone', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES], phoneKey: 'a1'.repeat(32), clientId: '55555555-5555-4555-8555-555555555555',
    });
    const asPhone = resolveDashboardCredential({ authorization: `Bearer ${phone.token}` }, { mode: 'link', remoteKeyHex: 'a1'.repeat(32), pairingId: null });
    expect((await read(await handleConnectorSelfRevoke(asPhone))).status).toBe(403);

    const asConnector = resolveDashboardCredential({ authorization: `Bearer ${token}` }, { mode: 'link', remoteKeyHex: CONNECTOR_KEY, pairingId: null });
    expect(asConnector?.kind).toBe('connector');
    expect((await read(await handleConnectorSelfRevoke(asConnector))).json).toEqual({ ok: true });
    expect(verifyAccessToken(token)).toEqual({ ok: false });
  });

  it('routes DELETE /api/connectors/self through the self handler, not the root-only revoke', async () => {
    const req = HttpServerRequest.fromWeb(new Request('http://localhost/api/connectors/self', { method: 'DELETE' }))
      .modify({ remoteAddress: Option.some('127.0.0.1') });
    const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
      HttpRouter.toHttpEffect(connectorsRouteLayer),
      (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
    )));
    const { status, json } = await read(response);
    expect(status).toBe(403);
    expect(json.error).toBe('only a paired connector may revoke itself');
  });
});

/** Issue a connector pairing as root and return a pairing marker for its code, as the handshake would produce. */
async function connectorPairingMarker(remoteKeyHex: string, body: Record<string, unknown> = { name: 'bot:desk', scopes: ['tell'] }): Promise<ChannelMarker> {
  const { json } = await read(await handleConnectorPairing('internal-token', JSON.stringify(body)));
  const code = parseConnectorPairLink(json.pairingString as string)!.code;
  return { mode: 'pairing', remoteKeyHex, pairingId: pairingSecrets(nodeCrypto, code).pairingId };
}

function exchangeBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, clientId: CLIENT_ID, label: 'desk-host', ...overrides });
}

describe('POST /api/connectors/exchange (PAN-4949 D-8, D-17)', () => {
  it('mints a connector token bound to the channel key with the intent name and scopes', async () => {
    const { status, json, cacheControl } = await read(await handleConnectorsExchange(exchangeBody(), await connectorPairingMarker(CONNECTOR_KEY)));
    expect(status).toBe(200);
    expect(cacheControl).toBe('no-store');
    expect(json.v).toBe(1);
    expect(json.token).toMatch(/^odk_/);
    expect(json.scopes).toEqual(['read:state', 'tell']);
    expect((json.descriptor as { capabilities: { connector?: boolean } }).capabilities.connector).toBe(true);
    const verified = verifyAccessToken(json.token as string);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.record).toMatchObject({ id: json.tokenId, kind: 'connector', connectorKey: CONNECTOR_KEY, clientId: CLIENT_ID, name: 'bot:desk' });

    const link: ChannelMarker = { mode: 'link', remoteKeyHex: CONNECTOR_KEY, pairingId: null };
    expect(resolveDashboardCredential({ authorization: `Bearer ${json.token}` }, link)?.kind).toBe('connector');
    expect(resolveDashboardCredential({ authorization: `Bearer ${json.token}` })).toBeNull();
  });

  it('refuses a plain pairing code, a link or missing marker, and a second use of the same pairingId', async () => {
    const plain = issuePairingCredential().credential;
    const plainMarker: ChannelMarker = { mode: 'pairing', remoteKeyHex: CONNECTOR_KEY, pairingId: pairingSecrets(nodeCrypto, plain).pairingId };
    const refused = await read(await handleConnectorsExchange(exchangeBody(), plainMarker));
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('not-a-connector-code');
    expect((await read(await handleConnectorsExchange(exchangeBody(), { mode: 'link', remoteKeyHex: CONNECTOR_KEY, pairingId: null }))).status).toBe(403);
    expect((await read(await handleConnectorsExchange(exchangeBody(), null))).status).toBe(403);

    const marker = await connectorPairingMarker(CONNECTOR_KEY);
    expect((await read(await handleConnectorsExchange(exchangeBody(), marker))).status).toBe(200);
    expect((await read(await handleConnectorsExchange(exchangeBody(), { ...marker, remoteKeyHex: 'c3'.repeat(32) }))).status).toBe(403);
  });

  it('answers 409 link-key-in-use for a key already bound to an active phone or connector', async () => {
    await createAccessToken({ name: 'phone', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES], phoneKey: 'a1'.repeat(32), clientId: '55555555-5555-4555-8555-555555555555' });
    const byPhone = await read(await handleConnectorsExchange(exchangeBody(), await connectorPairingMarker('a1'.repeat(32))));
    expect(byPhone.status).toBe(409);
    expect(byPhone.json.code).toBe('link-key-in-use');

    await mintConnector();
    const byConnector = await read(await handleConnectorsExchange(exchangeBody({ clientId: '66666666-6666-4666-8666-666666666666' }), await connectorPairingMarker(CONNECTOR_KEY)));
    expect(byConnector.status).toBe(409);
    expect(byConnector.json.code).toBe('link-key-in-use');
  });

  it('revokes the earlier connector with the same clientId', async () => {
    const first = await read(await handleConnectorsExchange(exchangeBody(), await connectorPairingMarker(CONNECTOR_KEY)));
    const second = await read(await handleConnectorsExchange(exchangeBody(), await connectorPairingMarker('c2'.repeat(32))));
    expect(second.status).toBe(200);
    expect(verifyAccessToken(first.json.token as string)).toEqual({ ok: false });
    expect((await listAccessTokens()).find((record) => record.id === first.json.tokenId)?.revokedAt).toEqual(expect.any(String));
    expect(listActiveRecordsOfKind('connector').map((record) => record.id)).toEqual([second.json.tokenId]);
  });

  it('remoteGateRejection admits the exchange only from a pairing marker', async () => {
    const request = (peer: string | undefined) => HttpServerRequest
      .fromWeb(new Request('http://dashboard.test/api/connectors/exchange', { method: 'POST' }))
      .modify({ remoteAddress: peer ? Option.some(peer) : Option.none() });
    const pairing: ChannelMarker = { mode: 'pairing', remoteKeyHex: CONNECTOR_KEY, pairingId: 'cd'.repeat(16) };
    expect(remoteGateRejection(request(undefined), pairing)).toBeNull();
    expect(remoteGateRejection(request('127.0.0.1'), null)).toEqual({ status: 401 });
    expect(remoteGateRejection(request(undefined), { mode: 'link', remoteKeyHex: CONNECTOR_KEY, pairingId: null })).toEqual({ status: 401 });
  });
});
