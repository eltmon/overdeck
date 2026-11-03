import { describe, expect, it } from 'vitest';
import type { AccountBinding, AccountVerifyResult } from '../../../../services/connect/src/account.ts';
import { directoryToken, verifyIdentity } from '../../../../services/connect/src/account.ts';
import type { ConnectIdentity, Deps, Env } from '../../../../services/connect/src/env.ts';
import { HDR_IDENTITY, parseConfig } from '../../../../services/connect/src/env.ts';
import { handle } from '../../../../services/connect/src/routes.ts';

const BASE = 'https://connect.test';
const TOKEN = `odd_${'a'.repeat(64)}`;
const OTHER_TOKEN = `odd_${'b'.repeat(64)}`;
const deps: Deps = {
  now: () => 1_700_000_000_000,
  fetch: () => Promise.reject(new Error('unexpected outbound fetch')),
  randomBytes: (n) => new Uint8Array(n),
};

const TESTER: AccountVerifyResult = {
  ok: true,
  userId: 'u-1',
  githubId: 1,
  deviceId: 'd-1',
  entitlement: { plan: 'tester', maxDevices: null },
};

function account(result: AccountVerifyResult | (() => Promise<AccountVerifyResult>)): AccountBinding {
  return { verifyDevice: typeof result === 'function' ? result : async () => result };
}

/** A fake DIRECTORY namespace recording the stub name and the forwarded request. */
function fakeDirectory() {
  const calls: Array<{ name: string; path: string; headers: Headers }> = [];
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (input: string, init: RequestInit = {}) => {
        calls.push({ name: id.name, path: new URL(input).pathname, headers: new Headers(init.headers) });
        return new Response(null, { status: 204 });
      },
    }),
  };
  return { ns: ns as unknown as DurableObjectNamespace, calls };
}

function envWith(over: Partial<Env> = {}): Env {
  return {
    DIRECTORY: fakeDirectory().ns,
    ACCOUNT: account(TESTER),
    PUBLIC_BASE_URL: BASE,
    STUN_URLS: 'stun:stun.cloudflare.com:3478',
    ...over,
  };
}

const upgrade = (authorization?: string): RequestInit => ({
  headers: { Upgrade: 'websocket', ...(authorization ? { Authorization: authorization } : {}) },
});

describe('connect routes (PAN-2356 WI-3)', () => {
  it('GET /healthz reports configuration and TURN without revealing values', async () => {
    const res = await handle(new Request(`${BASE}/healthz`), envWith(), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: false, apns: false, fcm: false });

    const withTurn = await handle(new Request(`${BASE}/healthz`), envWith({ TURN_KEY_ID: 'k', TURN_KEY_API_TOKEN: 't' }), deps);
    expect(await withTurn.json()).toEqual({ ok: true, configured: true, turn: true, apns: false, fcm: false });
  });

  it('GET /healthz reports APNs and FCM when their secrets parse, without revealing values (PAN-4830)', async () => {
    const secrets = {
      APNS_KEY_P8: 'apns-p8-secret-value',
      APNS_KEY_ID: 'apns-key-id-value',
      APNS_TEAM_ID: 'apns-team-id-value',
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'fcm-email-value@test', private_key: 'fcm-private-key-value' }),
      FCM_PROJECT_ID: 'fcm-project-id-value',
    };
    const res = await handle(new Request(`${BASE}/healthz`), envWith(secrets), deps);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, configured: true, turn: false, apns: true, fcm: true });
    for (const value of ['apns-p8-secret-value', 'apns-key-id-value', 'apns-team-id-value', 'fcm-email-value', 'fcm-private-key-value', 'fcm-project-id-value']) {
      expect(text).not.toContain(value);
    }
  });

  it('answers an unknown path with 404 JSON and a wrong method with 405', async () => {
    const res = await handle(new Request(`${BASE}/nope`), envWith(), deps);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const post = await handle(new Request(`${BASE}/v1/directory`, { method: 'POST' }), envWith(), deps);
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET');
  });

  it('refuses the directory socket with 401 without a token and 403 on grant_expired', async () => {
    const none = await handle(new Request(`${BASE}/v1/directory`, upgrade()), envWith(), deps);
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'invalid_token' });

    const expired = envWith({ ACCOUNT: account({ ok: false, error: 'grant_expired' }) });
    const res = await handle(new Request(`${BASE}/v1/directory`, upgrade(`Bearer ${TOKEN}`)), expired, deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'grant_expired' });

    const revoked = envWith({ ACCOUNT: account({ ok: false, error: 'device_revoked' }) });
    expect((await handle(new Request(`${BASE}/v1/directory`, upgrade(`Bearer ${TOKEN}`)), revoked, deps)).status).toBe(401);
  });

  it('answers 426 to a directory request without an upgrade', async () => {
    const res = await handle(new Request(`${BASE}/v1/directory`, { headers: { Authorization: `Bearer ${TOKEN}` } }), envWith(), deps);
    expect(res.status).toBe(426);
  });

  it('forwards a verified socket to the account Durable Object with the identity header', async () => {
    const dir = fakeDirectory();
    const res = await handle(new Request(`${BASE}/v1/directory`, upgrade(`Bearer ${TOKEN}`)), envWith({ DIRECTORY: dir.ns }), deps);
    expect(res.status).toBe(204);
    expect(dir.calls).toHaveLength(1);
    expect(dir.calls[0]?.name).toBe('u-1');
    expect(dir.calls[0]?.path).toBe('/socket');
    const identity = JSON.parse(dir.calls[0]?.headers.get(HDR_IDENTITY) ?? '{}') as ConnectIdentity;
    expect(identity).toEqual({ userId: 'u-1', githubId: 1, deviceId: 'd-1', plan: 'tester', maxDevices: null });
  });

  it('answers 503 when PUBLIC_BASE_URL is unset, except /healthz', async () => {
    const env = envWith({ PUBLIC_BASE_URL: undefined });
    const res = await handle(new Request(`${BASE}/v1/directory`, upgrade(`Bearer ${TOKEN}`)), env, deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured', missing: ['PUBLIC_BASE_URL'] });
    expect(await (await handle(new Request(`${BASE}/healthz`), env, deps)).json()).toMatchObject({ configured: false });
  });

  it('answers 429 when the per-device connect limit is spent', async () => {
    const limiter = { limit: async ({ key }: { key: string }) => ({ success: key !== 'd-1' }) } as unknown as RateLimit;
    const res = await handle(new Request(`${BASE}/v1/directory`, upgrade(`Bearer ${TOKEN}`)), envWith({ CONNECT_LIMIT: limiter }), deps);
    expect(res.status).toBe(429);
  });
});

describe('directory bearer subprotocol (PAN-4829 WI-1)', () => {
  /** An account binding that records every token it was asked to verify. */
  function recordingAccount() {
    const tokens: string[] = [];
    const binding: AccountBinding = {
      verifyDevice: async (token) => {
        tokens.push(token);
        return TESTER;
      },
    };
    return { binding, tokens };
  }

  const withHeaders = (headers: Record<string, string>): RequestInit => ({ headers: { Upgrade: 'websocket', ...headers } });

  it('accepts the device token as the overdeck.bearer subprotocol', async () => {
    const dir = fakeDirectory();
    const acc = recordingAccount();
    const req = new Request(`${BASE}/v1/directory`, withHeaders({ 'Sec-WebSocket-Protocol': `overdeck.bearer.${TOKEN}` }));
    const res = await handle(req, envWith({ DIRECTORY: dir.ns, ACCOUNT: acc.binding }), deps);
    expect(res.status).toBe(204);
    expect(acc.tokens).toEqual([TOKEN]);
    expect(dir.calls).toHaveLength(1);
    const identity = JSON.parse(dir.calls[0]?.headers.get(HDR_IDENTITY) ?? '{}') as ConnectIdentity;
    expect(identity.userId).toBe('u-1');
    // The token never reaches the Durable Object (NFR-4).
    expect([...(dir.calls[0]?.headers.entries() ?? [])].some(([, v]) => v.includes(TOKEN))).toBe(false);
  });

  it('prefers Authorization over the subprotocol', async () => {
    const dir = fakeDirectory();
    const acc = recordingAccount();
    const req = new Request(
      `${BASE}/v1/directory`,
      withHeaders({ Authorization: `Bearer ${TOKEN}`, 'Sec-WebSocket-Protocol': `overdeck.bearer.${OTHER_TOKEN}` }),
    );
    const res = await handle(req, envWith({ DIRECTORY: dir.ns, ACCOUNT: acc.binding }), deps);
    expect(res.status).toBe(204);
    expect(acc.tokens).toEqual([TOKEN]);
  });

  it('refuses a malformed bearer subprotocol with 401', async () => {
    for (const offered of ['overdeck.bearer.odd_short', 'overdeck.bearer.']) {
      const dir = fakeDirectory();
      const acc = recordingAccount();
      const req = new Request(`${BASE}/v1/directory`, withHeaders({ 'Sec-WebSocket-Protocol': offered }));
      const res = await handle(req, envWith({ DIRECTORY: dir.ns, ACCOUNT: acc.binding }), deps);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
      expect(dir.calls).toHaveLength(0);
      expect(acc.tokens).toEqual([]);
    }
  });

  it('takes the bearer entry from a list', async () => {
    const dir = fakeDirectory();
    const acc = recordingAccount();
    const req = new Request(`${BASE}/v1/directory`, withHeaders({ 'Sec-WebSocket-Protocol': `chat, overdeck.bearer.${TOKEN}` }));
    const res = await handle(req, envWith({ DIRECTORY: dir.ns, ACCOUNT: acc.binding }), deps);
    expect(res.status).toBe(204);
    expect(dir.calls).toHaveLength(1);
    expect(acc.tokens).toEqual([TOKEN]);
  });

  it('directoryToken reads Authorization first, then the first bearer subprotocol entry', () => {
    const headers = (h: Record<string, string>) => new Headers(h);
    expect(directoryToken(headers({ 'Sec-WebSocket-Protocol': `overdeck.bearer.${TOKEN}` }))).toEqual({
      authorization: `Bearer ${TOKEN}`,
      protocol: `overdeck.bearer.${TOKEN}`,
    });
    expect(
      directoryToken(headers({ Authorization: `Bearer ${TOKEN}`, 'Sec-WebSocket-Protocol': `overdeck.bearer.${OTHER_TOKEN}` })),
    ).toEqual({ authorization: `Bearer ${TOKEN}`, protocol: null });
    expect(directoryToken(headers({ 'Sec-WebSocket-Protocol': 'overdeck.bearer.odd_short' }))).toEqual({ authorization: null, protocol: null });
    expect(directoryToken(headers({ 'Sec-WebSocket-Protocol': 'overdeck.bearer.' }))).toEqual({ authorization: null, protocol: null });
    expect(directoryToken(headers({ 'Sec-WebSocket-Protocol': `chat, overdeck.bearer.${TOKEN}` }))).toEqual({
      authorization: `Bearer ${TOKEN}`,
      protocol: `overdeck.bearer.${TOKEN}`,
    });
    expect(directoryToken(headers({}))).toEqual({ authorization: null, protocol: null });
  });
});

describe('verifyIdentity', () => {
  it('maps a thrown account call to 503 account_unavailable', async () => {
    const env = envWith({ ACCOUNT: account(() => Promise.reject(new Error('down'))) });
    expect(await verifyIdentity(env, `Bearer ${TOKEN}`)).toEqual({ ok: false, status: 503, error: 'account_unavailable' });
  });

  it('carries the free plan and its machine limit', async () => {
    const env = envWith({ ACCOUNT: account({ ...TESTER, entitlement: { plan: 'free', maxDevices: 3 } }) });
    expect(await verifyIdentity(env, `Bearer ${TOKEN}`)).toMatchObject({ ok: true, identity: { plan: 'free', maxDevices: 3 } });
  });

  it('reports an account service without an entitlement as outdated', async () => {
    const { entitlement: _omit, ...bare } = TESTER as Extract<AccountVerifyResult, { ok: true }>;
    const env = envWith({ ACCOUNT: account(bare) });
    expect(await verifyIdentity(env, `Bearer ${TOKEN}`)).toEqual({ ok: false, status: 503, error: 'account_service_outdated' });
  });

  it('rejects a malformed bearer', async () => {
    expect(await verifyIdentity(envWith(), 'Bearer odd_short')).toEqual({ ok: false, status: 401, error: 'invalid_token' });
  });
});

describe('parseConfig', () => {
  it('splits STUN_URLS and trims the base URL', () => {
    expect(parseConfig(envWith({ PUBLIC_BASE_URL: 'https://c.test/', STUN_URLS: 'stun:a:1, stun:b:2' }))).toEqual({
      ok: true,
      config: { publicBaseUrl: 'https://c.test', stunUrls: ['stun:a:1', 'stun:b:2'], turn: null },
    });
  });
});
