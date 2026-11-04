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
  verifyAccessToken,
} = await import('../../../lib/access-tokens.js');
const { openChannel } = await import('../../../lib/anywhere/channel/open.js');
const { _resetChannelListenerForTests, installChannelListener, liveChannelCount } = await import('../channel-listener.js');
const { _resetConnectorPairingForTests, takeConnectorIntent } = await import('../connector-pairing.js');
const { _resetPairingCredentialsForTests } = await import('../pairing-credentials.js');
const { resolveDashboardCredential } = await import('../routes/dashboard-auth.js');
const { connectorsRouteLayer, handleConnectorList, handleConnectorPairing, handleConnectorRevoke, handleConnectorSelfRevoke } = await import('../routes/connectors.js');
type MachineKeyPair = import('../../../lib/anywhere/machine-key.js').MachineKeyPair;

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
