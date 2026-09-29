/**
 * PAN-3762 W2.3: pairing credentials are single use, expire after 10 minutes,
 * are rate limited on failure, never leak the internal token, and cannot be
 * issued by a paired device.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { _resetAccessTokensForTests, createAccessToken } = await import('../../../lib/access-tokens.js');
const { _resetInternalTokenCacheForTests, INTERNAL_TOKEN_HEADER } = await import('../../../lib/internal-token.js');
const { _resetDashboardSessionTokenForTests, dashboardCsrfToken } = await import('../routes/dashboard-auth.js');
const { _resetPairingCredentialsForTests } = await import('../pairing-credentials.js');
const { pairingRouteLayer } = await import('../routes/pairing.js');

const INTERNAL_TOKEN = 'pairing-internal-token-0123456789';
const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(pairingRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
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

async function issue() {
  const res = await post('/api/pairing/credentials', { label: 'phone' }, { [INTERNAL_TOKEN_HEADER]: INTERNAL_TOKEN });
  expect(res.status).toBe(200);
  return res;
}

function exchange(credential: string, delivery: 'cookie' | 'bearer' = 'cookie') {
  return post('/api/pairing/exchange', { credential, label: 'Browser on test', delivery }, { Origin: 'http://localhost:3011' });
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
});

afterEach(async () => {
  vi.useRealTimers();
  _resetAccessTokensForTests();
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
    expect(res.json.error).toContain('paired device');
  });

  it('rejects an exchange from an untrusted Origin', async () => {
    const issued = await issue();
    const res = await post('/api/pairing/exchange', { credential: issued.json.credential, label: 'x', delivery: 'cookie' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});
