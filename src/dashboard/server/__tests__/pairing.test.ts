/**
 * PAN-3762 W2.3: pairing credentials are single use, expire after 10 minutes,
 * are rate limited on failure, never leak the internal token, and cannot be
 * issued by a paired device or (PAN-2351 D-11) an access token.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, _settleAccessTokenWritesForTests, createAccessToken, PHONE_TOKEN_SCOPES, verifyAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { _resetPairingCredentialsForTests } = await import('../pairing-credentials.js');
const { pairingRouteLayer } = await import('../routes/pairing.js');
const { _resetChannelListenerForTests, installChannelListener, liveChannelCount } = await import('../channel-listener.js');
const { openChannel } = await import('../../../lib/anywhere/channel/open.js');
type MachineKeyPair = import('../../../lib/anywhere/machine-key.js').MachineKeyPair;

const _require = createRequire(import.meta.url);
const dh = _require('noise-handshake/dh') as { generateKeyPair(): MachineKeyPair };

const INTERNAL_TOKEN = 'pairing-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
let home: string;
const cleanups: Array<() => Promise<void> | void> = [];

async function request(method: string, path: string, body: unknown, headers: Record<string, string> = {}, peer = '127.0.0.1') {
  // The local browser is a loopback peer; PAN-4645 refuses cookie pairing to remote plain-HTTP peers.
  const req = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })).modify({ remoteAddress: Option.some(peer) });
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(pairingRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
  )));
  const raw = response as { status: number; headers: Record<string, string>; body: { body?: Uint8Array } };
  const text = raw.body?.body ? new TextDecoder().decode(raw.body.body) : '';
  return {
    status: raw.status,
    setCookie: raw.headers['set-cookie'] ?? '',
    cacheControl: raw.headers['cache-control'],
    text,
    json: text ? JSON.parse(text) : null,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}, peer = '127.0.0.1') {
  return request('POST', path, body, headers, peer);
}

async function issue() {
  const res = await post('/api/pairing/credentials', { label: 'phone' }, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
  expect(res.status).toBe(200);
  return res;
}

function exchange(credential: string, delivery: 'cookie' | 'bearer' = 'cookie', extra: { peer?: string; headers?: Record<string, string> } = {}) {
  return post('/api/pairing/exchange', { credential, label: 'Browser on test', delivery }, { Origin: 'http://localhost:3011', ...extra.headers }, extra.peer);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
  home = await mkdtemp(join(tmpdir(), 'pan-3762-pairing-'));
  process.env.OVERDECK_HOME = home;
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  _resetAccessTokensForTests();
  _resetPairingCredentialsForTests();
  _resetChannelListenerForTests();
});

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  _resetChannelListenerForTests();
  delete process.env.OVERDECK_INTERNAL_TOKEN;
  _resetInternalTokenCacheForTests();
  _resetDashboardSessionTokenForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('pairing credentials and exchange (PAN-3762)', () => {
  it('issues an odp_ credential in the URL fragment and exchanges it exactly once', async () => {
    const issued = await issue();
    expect(issued.json.credential).toMatch(/^odp_[0-9a-f]{64}$/);
    expect(issued.json.pairingPath).toBe(`/#pair=${issued.json.credential}`);
    expect(issued.cacheControl).toBe('no-store');

    const first = await exchange(issued.json.credential);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ deviceId: expect.any(String), environmentId: expect.any(String), csrfToken: expect.any(String) });
    expect(first.setCookie).toMatch(/^overdeck_device=odk_[0-9a-f]{64};/);
    expect(first.cacheControl).toBe('no-store');

    const second = await exchange(issued.json.credential);
    expect(second.status).toBe(401);
  });

  it('returns the device token in the body for bearer delivery', async () => {
    const issued = await issue();
    const res = await exchange(issued.json.credential, 'bearer');
    expect(res.status).toBe(200);
    expect(res.json.token).toMatch(/^odk_[0-9a-f]{64}$/);
    expect(res.setCookie).toBe('');
  });

  it('answers 410 once the credential is older than 10 minutes', async () => {
    const issued = await issue();
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect((await exchange(issued.json.credential)).status).toBe(410);
  });

  it('answers 429 on the 11th failure within 60 s and allows a success after 60 s', async () => {
    const issued = await issue();
    for (let i = 0; i < 10; i += 1) {
      expect((await exchange(`odp_${'0'.repeat(63)}${i}`)).status).toBe(401);
    }
    expect((await exchange(issued.json.credential)).status).toBe(429);
    vi.advanceTimersByTime(60_000);
    expect((await exchange(issued.json.credential)).status).toBe(200);
  });

  it('never returns the internal token in a body or Set-Cookie', async () => {
    const issued = await issue();
    const cookie = await exchange(issued.json.credential);
    const bearer = await exchange((await issue()).json.credential, 'bearer');
    for (const res of [issued, cookie, bearer]) {
      expect(res.text).not.toContain(INTERNAL_TOKEN);
      expect(res.setCookie).not.toContain(INTERNAL_TOKEN);
    }
  });

  it('refuses to let a paired device issue credentials', async () => {
    const { token } = await createAccessToken({ name: 'tablet', scopes: ['admin'], kind: 'device' });
    const res = await post('/api/pairing/credentials', {}, {
      authorization: `Bearer ${token}`,
      'x-overdeck-csrf-token': dashboardCsrfToken(),
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('only the internal token or the root session can issue pairing credentials');
  });

  it('refuses to let an admin access token issue credentials (PAN-2351)', async () => {
    const { token } = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    const res = await post('/api/pairing/credentials', {}, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('only the internal token or the root session can issue pairing credentials');
    expect(res.cacheControl).toBe('no-store');
  });

  it('rejects an exchange from an untrusted Origin', async () => {
    const issued = await issue();
    const res = await post('/api/pairing/exchange', { credential: issued.json.credential, label: 'x', delivery: 'cookie' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('cookie pairing over plain HTTP (PAN-4645 WI-16, D-4645-13)', () => {
  it('ac3: a LAN peer on plain HTTP gets 403 use-https for cookie delivery and keeps its credential; bearer proceeds', async () => {
    const { credential } = (await issue()).json as { credential: string };
    const refused = await exchange(credential, 'cookie', { peer: '192.0.2.44' });
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({ error: 'use-https' });
    expect(refused.setCookie).toBe('');

    // The credential was not consumed: the same code still pairs over HTTPS (forwarded proto) ...
    const viaHttps = await exchange(credential, 'cookie', { peer: '192.0.2.44', headers: { 'X-Forwarded-Proto': 'https' } });
    expect(viaHttps.status).toBe(200);
    expect(viaHttps.setCookie).toContain('overdeck_device=');

    // ... and bearer delivery from a plain-HTTP LAN peer is unaffected.
    const { credential: second } = (await issue()).json as { credential: string };
    const bearer = await exchange(second, 'bearer', { peer: '192.0.2.44' });
    expect(bearer.status).toBe(200);
    expect(bearer.json.token).toMatch(/^odk_/);
  });
});

describe('phones in GET /api/devices and DELETE /api/devices/:id (PAN-4835 WI-9)', () => {
  function admin(path: string, method = 'GET') {
    return request(method, path, undefined, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
  }

  it('lists a device row with kind device and a phone row with kind phone, never key material', async () => {
    const { token: deviceToken } = await createAccessToken({ name: 'tablet', scopes: ['admin'], kind: 'device' });
    const { token: phoneToken } = await createAccessToken({
      name: 'iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: 'a1'.repeat(32), clientId: '11111111-1111-4111-8111-111111111111', pushKey: 'c3'.repeat(32),
    });
    const { json } = await admin('/api/devices');
    const devices = json.devices as Array<Record<string, unknown>>;
    const device = devices.find((d) => d.name === 'tablet');
    const phone = devices.find((d) => d.name === 'iris');
    expect(device).toMatchObject({ kind: 'device' });
    expect(phone).toMatchObject({ kind: 'phone' });
    for (const row of [device, phone]) {
      expect(row).not.toHaveProperty('tokenHash');
      expect(row).not.toHaveProperty('phoneKey');
      expect(row).not.toHaveProperty('pushKey');
    }
    expect(verifyAccessToken(deviceToken).ok).toBe(true);
    expect(verifyAccessToken(phoneToken).ok).toBe(true);
  });

  it('revokes a phone with a root credential, closing its channels; a token record id still 404s', async () => {
    const serverKey = dh.generateKeyPair();
    const phoneKey = dh.generateKeyPair();
    const phoneHex = phoneKey.publicKey.toString('hex');
    const { record } = await createAccessToken({
      name: 'iris', kind: 'phone', scopes: [...PHONE_TOKEN_SCOPES],
      phoneKey: phoneHex, clientId: '11111111-1111-4111-8111-111111111111',
    });

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

    const res = await admin(`/api/devices/${record.id}`, 'DELETE');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, device: { id: record.id, kind: 'phone' } });
    await channelClosed;
    expect(liveChannelCount()).toBe(0);

    const { record: tokenRecord } = await createAccessToken({ name: 'ci', scopes: ['admin'], kind: 'token' });
    expect((await admin(`/api/devices/${tokenRecord.id}`, 'DELETE')).status).toBe(404);
  });
});
