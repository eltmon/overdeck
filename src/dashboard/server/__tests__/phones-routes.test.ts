/**
 * PAN-4835 WI-7, WI-8: POST /api/phones/exchange mints the phone token bound
 * to the pairing channel's remote key, refuses plain sockets and link
 * channels, and revokes a previous active phone record with the same
 * clientId; a key already held by an active phone record gets 409.
 * DELETE /api/phones/self, PUT /api/phones/self/push-key and
 * PUT /api/phones/self/notification-preferences (PAN-5019 WI-5) take exactly
 * a phone credential.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const {
  _resetAccessTokensForTests,
  _settleAccessTokenWritesForTests,
  listActiveRecordsOfKind,
  PHONE_TOKEN_SCOPES,
  verifyAccessToken,
} = await import('../../../lib/access-tokens.js');
const { openChannel } = await import('../../../lib/anywhere/channel/open.js');
const { _resetChannelListenerForTests, installChannelListener, liveChannelCount } = await import('../channel-listener.js');
const { remoteGateRejection } = await import('../remote-request-gate.js');
const { resolveDashboardCredential } = await import('../routes/dashboard-auth.js');
const { handlePhonesExchange, handlePhonesNotificationPreferences, handlePhonesPushKey, handlePhonesSelfRevoke } = await import('../routes/phones.js');
const { loadPhoneNotificationPreferences, resetPhoneNotificationPreferencesCacheForTests } = await import('../../../lib/push/phone-preferences-store.js');
type ChannelMarker = import('../channel-peer.js').ChannelMarker;
type MachineKeyPair = import('../../../lib/anywhere/machine-key.js').MachineKeyPair;

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const KEY_A = 'a1'.repeat(32);
const PAIRING: ChannelMarker = { mode: 'pairing', remoteKeyHex: KEY_A, pairingId: 'cd'.repeat(16) };
const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: KEY_A, pairingId: null };
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const originalHome = process.env.OVERDECK_HOME;
let home: string;
const cleanups: Array<() => Promise<void> | void> = [];

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: Record<string, unknown> }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, clientId: CLIENT_ID, label: 'iris', pushKeyHex: 'c3'.repeat(32), ...overrides });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4835-phones-routes-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
  resetPhoneNotificationPreferencesCacheForTests();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
  resetPhoneNotificationPreferencesCacheForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('POST /api/phones/exchange (PAN-4835 WI-7)', () => {
  it('ac7: mints a phone token bound to the channel key with the eight scopes and the push key', async () => {
    const { status, json } = await read(await handlePhonesExchange(body(), PAIRING));
    expect(status).toBe(200);
    expect(json.v).toBe(1);
    expect(json.token).toMatch(/^odk_/);
    const verified = verifyAccessToken(json.token as string);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.record).toMatchObject({
      id: json.tokenId, kind: 'phone', phoneKey: KEY_A, clientId: CLIENT_ID, pushKey: 'c3'.repeat(32), name: 'iris',
    });
    expect(verified.record.scopes).toEqual([...PHONE_TOKEN_SCOPES]);
    expect((json.descriptor as { capabilities: { phoneApp: boolean } }).capabilities.phoneApp).toBe(true);
  });

  it('ac7: without a pairing channel marker the route answers 403, link channels included; no marker also 403', async () => {
    expect((await read(await handlePhonesExchange(body(), null))).status).toBe(403);
    expect((await read(await handlePhonesExchange(body(), LINK))).status).toBe(403);
    expect(listActiveRecordsOfKind('phone')).toEqual([]);
  });

  it('ac7: rejects a bad clientId, an over-long label and a bad pushKeyHex with 400, minting nothing', async () => {
    expect((await read(await handlePhonesExchange(body({ clientId: 'not-a-uuid' }), PAIRING))).status).toBe(400);
    expect((await read(await handlePhonesExchange(body({ label: 'x'.repeat(65) }), PAIRING))).status).toBe(400);
    expect((await read(await handlePhonesExchange(body({ pushKeyHex: 'nope' }), PAIRING))).status).toBe(400);
    expect((await read(await handlePhonesExchange('not json', PAIRING))).status).toBe(400);
    expect(listActiveRecordsOfKind('phone')).toEqual([]);
  });

  it('ac7: a second exchange with the same clientId and a new key revokes the first; only one active record remains', async () => {
    const first = await read(await handlePhonesExchange(body(), PAIRING));
    expect(first.status).toBe(200);

    const otherKey = 'b2'.repeat(32);
    const second = await read(await handlePhonesExchange(body(), { mode: 'pairing', remoteKeyHex: otherKey, pairingId: 'ef'.repeat(16) }));
    expect(second.status).toBe(200);

    expect(verifyAccessToken(first.json.token as string)).toEqual({ ok: false });
    const active = listActiveRecordsOfKind('phone');
    expect(active.map((record) => record.id)).toEqual([second.json.tokenId]);
    expect(active[0]!.phoneKey).toBe(otherKey);
  });

  it('ac7: an exchange whose channel key already belongs to an active phone record gets 409 and the record stays active', async () => {
    const first = await read(await handlePhonesExchange(body(), PAIRING));
    expect(first.status).toBe(200);

    const repeat = await read(await handlePhonesExchange(body({ clientId: '22222222-2222-4222-8222-222222222222' }), PAIRING));
    expect(repeat.status).toBe(409);
    expect(repeat.json.code).toBe('link-key-in-use');
    expect(verifyAccessToken(first.json.token as string).ok).toBe(true);
    expect(listActiveRecordsOfKind('phone')).toHaveLength(1);
  });

  it('remoteGateRejection admits the exchange on a pairing marker and refuses it on a plain request', async () => {
    const { HttpServerRequest } = await import('effect/unstable/http');
    const { Option } = await import('effect');
    const request = (peer: string | undefined) => HttpServerRequest
      .fromWeb(new Request('http://dashboard.test/api/phones/exchange', { method: 'POST' }))
      .modify({ remoteAddress: peer ? Option.some(peer) : Option.none() });
    expect(remoteGateRejection(request(undefined), PAIRING)).toBeNull();
    expect(remoteGateRejection(request('127.0.0.1'), null)).toEqual({ status: 401 });
  });
});

describe('DELETE /api/phones/self and PUT /api/phones/self/push-key (PAN-4835 WI-8)', () => {
  it('ac8: self-revoke takes exactly a phone credential; others get 403 and nothing is revoked', async () => {
    const { json: exchanged } = await read(await handlePhonesExchange(body(), PAIRING));
    const asDevice = { kind: 'device', deviceId: 'd', scopes: ['admin'] } as const;
    expect((await read(await handlePhonesSelfRevoke(asDevice))).status).toBe(403);
    expect((await read(await handlePhonesSelfRevoke({ kind: 'machine', tokenId: 'm', environmentId: 'e', scopes: ['admin'], actor: { agentId: 'unknown' }, access: 'operator' }))).status).toBe(403);
    expect((await read(await handlePhonesSelfRevoke(null))).status).toBe(403);
    expect(verifyAccessToken(exchanged.token as string).ok).toBe(true);

    const asPhone = resolveDashboardCredential({ authorization: `Bearer ${exchanged.token}` }, LINK);
    expect(asPhone?.kind).toBe('phone');
    expect((await read(await handlePhonesSelfRevoke(asPhone))).json).toEqual({ ok: true });
    expect(verifyAccessToken(exchanged.token as string)).toEqual({ ok: false });
    expect(listActiveRecordsOfKind('phone')).toEqual([]);
  });

  it('ac8: self-revoke closes every channel bound to the phone key', async () => {
    const serverKey = dh.generateKeyPair();
    const phoneKey = dh.generateKeyPair();
    const phoneHex = phoneKey.publicKey.toString('hex');
    const { json: exchanged } = await read(await handlePhonesExchange(body(), { mode: 'pairing', remoteKeyHex: phoneHex, pairingId: 'ab'.repeat(16) }));

    const http = createServer((_req, res) => res.end('ok'));
    installChannelListener(http, {
      primary: true,
      localKey: async () => serverKey,
      isPinnedPeer: (key) => key === phoneHex,
      takePairing: () => 'unknown',
      onPairingFailure: () => undefined,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise<void>((resolve) => http.close(() => resolve())));
    const channelPort = (http.address() as { port: number }).port;
    const channel = await openChannel(`tcp://127.0.0.1:${channelPort}`, { mode: 'link', localKey: phoneKey, remoteKeyHex: serverKey.publicKey.toString('hex') });
    cleanups.push(() => channel.destroy());
    expect(liveChannelCount()).toBe(1);
    const channelClosed = new Promise<void>((resolve) => channel.once('close', resolve));

    const asPhone = resolveDashboardCredential({ authorization: `Bearer ${exchanged.token}` }, { mode: 'link', remoteKeyHex: phoneHex, pairingId: null });
    await handlePhonesSelfRevoke(asPhone);
    await channelClosed;
    expect(liveChannelCount()).toBe(0);
  });

  it('ac8: push-key rotation takes exactly a phone credential and replaces pushKey; a bad key is 400', async () => {
    const { json: exchanged } = await read(await handlePhonesExchange(body(), PAIRING));
    const asPhone = resolveDashboardCredential({ authorization: `Bearer ${exchanged.token}` }, LINK);
    expect(asPhone?.kind).toBe('phone');

    const asMachine = { kind: 'machine', tokenId: 'm', environmentId: 'e', scopes: ['admin'], actor: { agentId: 'unknown' }, access: 'operator' } as const;
    expect((await read(await handlePhonesPushKey(asMachine, JSON.stringify({ pushKeyHex: 'd4'.repeat(32) })))).status).toBe(403);

    const newKey = 'd4'.repeat(32);
    expect((await read(await handlePhonesPushKey(asPhone, JSON.stringify({ pushKeyHex: newKey })))).json).toEqual({ ok: true });
    expect(listActiveRecordsOfKind('phone')[0]?.pushKey).toBe(newKey);

    expect((await read(await handlePhonesPushKey(asPhone, JSON.stringify({ pushKeyHex: 'not-hex' })))).status).toBe(400);
  });

  it('ac-5019: notification-preferences takes exactly a phone credential, stores valid prefs, and 400s an invalid body', async () => {
    const { json: exchanged } = await read(await handlePhonesExchange(body(), PAIRING));
    const asPhone = resolveDashboardCredential({ authorization: `Bearer ${exchanged.token}` }, LINK);
    expect(asPhone?.kind).toBe('phone');

    const asMachine = { kind: 'machine', tokenId: 'm', environmentId: 'e', scopes: ['admin'], actor: { agentId: 'unknown' }, access: 'operator' } as const;
    expect((await read(await handlePhonesNotificationPreferences(asMachine, JSON.stringify({ v: 1, pause: null, muted: [] })))).status).toBe(403);

    const prefs = { v: 1, pause: { until: null }, muted: ['failed'] };
    expect((await read(await handlePhonesNotificationPreferences(asPhone, JSON.stringify(prefs)))).json).toEqual({ ok: true });
    const stored = await loadPhoneNotificationPreferences();
    expect(stored.get(CLIENT_ID)).toEqual(prefs);

    expect((await read(await handlePhonesNotificationPreferences(asPhone, JSON.stringify({ v: 2, pause: null, muted: [] })))).status).toBe(400);
    expect((await read(await handlePhonesNotificationPreferences(asPhone, 'not json'))).status).toBe(400);
  });
});

describe('capabilities.phoneApp (PAN-4835 WI-11)', () => {
  it('buildEnvironmentDescriptor reports phoneApp: true, and a descriptor without it still decodes', async () => {
    const { buildEnvironmentDescriptor } = await import('../routes/environment.js');
    const descriptor = await buildEnvironmentDescriptor();
    expect(descriptor.capabilities.phoneApp).toBe(true);

    const { EnvironmentDescriptor } = await import('@overdeck/contracts');
    const { Schema } = await import('effect');
    const legacy = { ...descriptor, capabilities: { ...descriptor.capabilities, phoneApp: undefined } };
    delete (legacy.capabilities as { phoneApp?: boolean }).phoneApp;
    expect(() => Schema.decodeUnknownSync(EnvironmentDescriptor)(legacy)).not.toThrow();
  });
});
