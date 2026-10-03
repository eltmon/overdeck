import { describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '@overdeck/contracts';
import type { AccountBinding, AccountVerifyResult } from '../../../../services/share/src/account.ts';
import { sha256Hex } from '../../../../services/share/src/codes.ts';
import type { Deps, Env, RoomInitBody } from '../../../../services/share/src/env.ts';
import { HDR_HOST_TOKEN_HASH, parseConfig } from '../../../../services/share/src/env.ts';
import { HTML_CSP } from '../../../../services/share/src/pages.ts';
import { guardBody, handle, MAX_BODY_BYTES } from '../../../../services/share/src/routes.ts';

const TEST_BASE_URL = 'https://share.test';
const NOW = 1_700_000_000_000;

/** Deterministic, never-repeating-per-call randomness so successive short codes differ. */
let seq = 0;
const deps: Deps = {
  now: () => NOW,
  fetch: () => Promise.reject(new Error('unexpected outbound fetch')),
  randomBytes: (n) => Uint8Array.from({ length: n }, () => (seq++ * 37) % 252),
};

interface RoomCall {
  name: string;
  path: string;
  method: string;
  headers: Headers;
  body: string;
}

/** A fake ROOMS namespace: one recorded stub per short code, answered by `respond`. */
function fakeRooms(respond: (call: RoomCall) => Response | Promise<Response>) {
  const calls: RoomCall[] = [];
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (input: string, init: RequestInit = {}) => {
        const call: RoomCall = {
          name: id.name,
          path: new URL(input).pathname,
          method: init.method ?? 'GET',
          headers: new Headers(init.headers),
          body: typeof init.body === 'string' ? init.body : '',
        };
        calls.push(call);
        return respond(call);
      },
    }),
  };
  return { ns: ns as unknown as DurableObjectNamespace, calls };
}

function snapshotFor(init: RoomInitBody): RoomSnapshot {
  return {
    shortCode: init.shortCode,
    scope: init.scope,
    dataOwner: init.dataOwner,
    controllerGithubId: init.dataOwner.githubId,
    hostConnected: false,
    participants: [],
    blocked: [],
  };
}

/** Default DO behavior: init creates, status answers active, nothing else exists. */
function defaultRoom(call: RoomCall): Response {
  if (call.path === '/init') return Response.json(snapshotFor(JSON.parse(call.body) as RoomInitBody), { status: 201 });
  if (call.path === '/status') return Response.json({ status: 'active' });
  return new Response(null, { status: 404 });
}

const DEVICE_TOKEN = 'odd_' + 'a'.repeat(64);
const OWNER_OK: AccountVerifyResult = { ok: true, userId: 'u1', githubId: 42, githubLogin: 'octo', deviceId: 'd1' };

function fakeAccount(result: AccountVerifyResult | Error = OWNER_OK): { binding: AccountBinding; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    binding: {
      verifyDevice: async (token) => {
        calls.push(token);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

/** Fully configured Env. Pass `undefined` for a key to simulate an unset var or secret. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ROOMS: fakeRooms(defaultRoom).ns,
    ACCOUNT: fakeAccount().binding,
    PUBLIC_BASE_URL: TEST_BASE_URL,
    TURN_KEY_ID: 'turn-key-id',
    TURN_KEY_API_TOKEN: 'turn-api-token',
    ...overrides,
  };
}

const seen: Response[] = [];
async function call(method: string, path: string, env: Env = makeEnv(), init: RequestInit = {}): Promise<Response> {
  const res = await handle(new Request(`${TEST_BASE_URL}${path}`, { method, ...init }), env, deps);
  seen.push(res);
  return res;
}

describe('share service route table (PAN-658 share-scaffold)', () => {
  it('GET /healthz reports configured=false and turn=false when PUBLIC_BASE_URL and TURN secrets are unset', async () => {
    const env = makeEnv({ PUBLIC_BASE_URL: undefined, TURN_KEY_ID: undefined, TURN_KEY_API_TOKEN: undefined });
    const res = await call('GET', '/healthz', env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: false, turn: false });
  });

  it('GET /healthz reports configured=true once PUBLIC_BASE_URL is set', async () => {
    const res = await call('GET', '/healthz', makeEnv({ TURN_KEY_ID: undefined }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: false });
  });

  it('GET /healthz reports turn=true only when both TURN secrets are set', async () => {
    const res = await call('GET', '/healthz');
    expect(await res.json()).toEqual({ ok: true, configured: true, turn: true });

    const blank = await call('GET', '/healthz', makeEnv({ TURN_KEY_API_TOKEN: '  ' }));
    expect(await blank.json()).toEqual({ ok: true, configured: true, turn: false });
  });

  it('an unknown path returns 404 not_found', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('a wrong method on a known path returns 405 with an Allow header', async () => {
    const res = await call('POST', '/healthz');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('GET /healthz stays 200 when PUBLIC_BASE_URL is missing (it is exempt from the config gate)', async () => {
    const res = await call('GET', '/healthz', makeEnv({ PUBLIC_BASE_URL: '' }));
    expect(res.status).toBe(200);
  });

  it('parseConfig requires only PUBLIC_BASE_URL, strips trailing slashes and leaves TURN optional', () => {
    expect(parseConfig(makeEnv({ PUBLIC_BASE_URL: undefined }))).toEqual({ ok: false, missing: ['PUBLIC_BASE_URL'] });
    expect(parseConfig(makeEnv({ PUBLIC_BASE_URL: 'https://share.test//', TURN_KEY_ID: undefined }))).toEqual({
      ok: true,
      config: { publicBaseUrl: 'https://share.test', turn: null },
    });
    expect(parseConfig(makeEnv())).toEqual({
      ok: true,
      config: { publicBaseUrl: TEST_BASE_URL, turn: { keyId: 'turn-key-id', apiToken: 'turn-api-token' } },
    });
  });

  it('the body guard refuses more than 16 KiB with 413 and passes smaller bodies through intact', async () => {
    const big = new Request(`${TEST_BASE_URL}/x`, { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES + 1) });
    const refused = await guardBody(big);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      seen.push(refused.response);
      expect(refused.response.status).toBe(413);
      expect(await refused.response.json()).toEqual({ error: 'payload_too_large', maxBytes: MAX_BODY_BYTES });
    }

    const small = await guardBody(new Request(`${TEST_BASE_URL}/x`, { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES) }));
    expect(small.ok).toBe(true);
    if (small.ok) expect((await small.req.text()).length).toBe(MAX_BODY_BYTES);
  });

});

function createBody(scope: unknown = { kind: 'conversation', conversationId: 'c1' }): RequestInit {
  return { headers: { Authorization: `Bearer ${DEVICE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) };
}

describe('POST /v1/rooms (PAN-658 share-rooms-http)', () => {
  it('creates a room: 201 with joinUrl, an odh_ host token and the DO snapshot', async () => {
    const rooms = fakeRooms(defaultRoom);
    const account = fakeAccount();
    const res = await call('POST', '/v1/rooms', makeEnv({ ROOMS: rooms.ns, ACCOUNT: account.binding }), createBody());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { shortCode: string; hostToken: string; joinUrl: string; snapshot: RoomSnapshot };
    expect(body.hostToken).toMatch(/^odh_[0-9a-f]{64}$/);
    expect(body.joinUrl).toBe(`${TEST_BASE_URL}/s/${body.shortCode}`);
    expect(body.snapshot.dataOwner).toEqual({ githubId: 42, login: 'octo', avatarUrl: 'https://avatars.githubusercontent.com/u/42' });
    expect(account.calls).toEqual([DEVICE_TOKEN]);

    expect(rooms.calls).toHaveLength(1);
    const init = JSON.parse(rooms.calls[0]?.body ?? '') as RoomInitBody;
    expect(rooms.calls[0]?.name).toBe(body.shortCode);
    expect(rooms.calls[0]?.method).toBe('POST');
    expect(init).toEqual({
      shortCode: body.shortCode,
      scope: { kind: 'conversation', conversationId: 'c1' },
      dataOwner: body.snapshot.dataOwner,
      hostTokenHash: await sha256Hex(body.hostToken),
      createdAt: NOW,
    });
    expect(rooms.calls[0]?.body).not.toContain(body.hostToken);
  });

  it('a header without the odd_ prefix is 401 invalid_token and never calls verifyDevice', async () => {
    const account = fakeAccount();
    for (const authorization of ['Bearer odh_' + 'a'.repeat(64), 'Bearer ' + 'a'.repeat(64), `Basic ${DEVICE_TOKEN}`, null]) {
      const init = createBody();
      init.headers = authorization ? { Authorization: authorization } : {};
      const res = await call('POST', '/v1/rooms', makeEnv({ ACCOUNT: account.binding }), init);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    }
    expect(account.calls).toEqual([]);
  });

  it('maps account results: grant_expired 403, other errors 401, throw 503, missing login 503', async () => {
    const cases: Array<[AccountVerifyResult | Error, number, string]> = [
      [{ ok: false, error: 'grant_expired' }, 403, 'grant_expired'],
      [{ ok: false, error: 'device_revoked' }, 401, 'device_revoked'],
      [{ ok: false, error: 'account_deleted' }, 401, 'account_deleted'],
      [new Error('binding down'), 503, 'account_unavailable'],
      [{ ok: true, userId: 'u1', githubId: 42, deviceId: 'd1' }, 503, 'account_service_outdated'],
      [{ ok: true, userId: 'u1', githubId: 42, githubLogin: '', deviceId: 'd1' }, 503, 'account_service_outdated'],
    ];
    for (const [result, status, error] of cases) {
      const rooms = fakeRooms(defaultRoom);
      const res = await call('POST', '/v1/rooms', makeEnv({ ROOMS: rooms.ns, ACCOUNT: fakeAccount(result).binding }), createBody());
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error });
      expect(rooms.calls).toEqual([]);
    }
  });

  it('a refused rate limit is 429 rate_limited with Retry-After: 60, keyed by githubId', async () => {
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } as unknown as RateLimit;
    const res = await call('POST', '/v1/rooms', makeEnv({ ROOM_CREATE_LIMIT: limiter }), createBody());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(keys).toEqual(['42']);
  });

  it('an invalid scope or body is 400 invalid_request', async () => {
    const scopes: unknown[] = [
      null,
      'c1',
      { kind: 'task', conversationId: 'c1' },
      { kind: 'conversation' },
      { kind: 'conversation', conversationId: '' },
      { kind: 'conversation', conversationId: 'x'.repeat(201) },
      { kind: 'conversation', conversationId: 'bad\nid' },
      { kind: 'conversation', conversationId: 'bad\u0085id' },
      { kind: 'conversation', conversationId: 7 },
    ];
    for (const scope of scopes) {
      const res = await call('POST', '/v1/rooms', makeEnv(), createBody(scope));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
    }
    for (const body of ['{', '{}', '[]', 'null']) {
      const res = await call('POST', '/v1/rooms', makeEnv(), { headers: { Authorization: `Bearer ${DEVICE_TOKEN}` }, body });
      expect(res.status).toBe(400);
    }
  });

  it('accepts a 200-character conversation id and drops extra scope keys', async () => {
    const rooms = fakeRooms(defaultRoom);
    const id = 'c'.repeat(200);
    const res = await call('POST', '/v1/rooms', makeEnv({ ROOMS: rooms.ns }), createBody({ kind: 'conversation', conversationId: id, extra: 1 }));
    expect(res.status).toBe(201);
    expect((JSON.parse(rooms.calls[0]?.body ?? '') as RoomInitBody).scope).toEqual({ kind: 'conversation', conversationId: id });
  });

  it('retries with a fresh code when the DO answers 409, then gives up with 503 after 3 retries', async () => {
    let collisions = 1;
    const rooms = fakeRooms((c) => (c.path === '/init' && collisions-- > 0 ? new Response(null, { status: 409 }) : defaultRoom(c)));
    const res = await call('POST', '/v1/rooms', makeEnv({ ROOMS: rooms.ns }), createBody());
    expect(res.status).toBe(201);
    expect(rooms.calls).toHaveLength(2);
    expect(rooms.calls[0]?.name).not.toBe(rooms.calls[1]?.name);
    expect(((await res.json()) as { shortCode: string }).shortCode).toBe(rooms.calls[1]?.name);

    const full = fakeRooms(() => new Response(null, { status: 409 }));
    const exhausted = await call('POST', '/v1/rooms', makeEnv({ ROOMS: full.ns }), createBody());
    expect(exhausted.status).toBe(503);
    expect(await exhausted.json()).toEqual({ error: 'code_space_exhausted' });
    expect(full.calls).toHaveLength(4);
  });

  it('an unexpected DO status is 503 room_unavailable', async () => {
    const rooms = fakeRooms(() => new Response(null, { status: 500 }));
    const res = await call('POST', '/v1/rooms', makeEnv({ ROOMS: rooms.ns }), createBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'room_unavailable' });
  });

  it('without PUBLIC_BASE_URL it is 503 not_configured before any identity check', async () => {
    const account = fakeAccount();
    const res = await call('POST', '/v1/rooms', makeEnv({ PUBLIC_BASE_URL: undefined, ACCOUNT: account.binding }), createBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured', missing: ['PUBLIC_BASE_URL'] });
    expect(account.calls).toEqual([]);
  });

  it('a body over 16 KiB is 413 before the handler runs', async () => {
    const account = fakeAccount();
    const init = createBody({ kind: 'conversation', conversationId: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await call('POST', '/v1/rooms', makeEnv({ ACCOUNT: account.binding }), init);
    expect(res.status).toBe(413);
    expect(account.calls).toEqual([]);
  });

  it('GET /v1/rooms is 405 with Allow: POST', async () => {
    const res = await call('GET', '/v1/rooms');
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });
});

describe('DELETE /v1/rooms/:code', () => {
  const HOST_TOKEN = 'odh_' + 'b'.repeat(64);

  async function roomsAcceptingHostToken() {
    const hash = await sha256Hex(HOST_TOKEN);
    return fakeRooms((c) => new Response(null, { status: c.path === '/delete' && c.headers.get(HDR_HOST_TOKEN_HASH) === hash ? 204 : 404 }));
  }

  it('the right host token ends the room with 204; the DO receives only the hash', async () => {
    const rooms = await roomsAcceptingHostToken();
    const res = await call('DELETE', '/v1/rooms/bcdf-ghjk', makeEnv({ ROOMS: rooms.ns }), { headers: { Authorization: `Bearer ${HOST_TOKEN}` } });
    expect(res.status).toBe(204);
    expect(rooms.calls).toHaveLength(1);
    expect(rooms.calls[0]).toMatchObject({ name: 'BCDFGHJK', path: '/delete', method: 'POST' });
    expect(rooms.calls[0]?.headers.get(HDR_HOST_TOKEN_HASH)).toBe(await sha256Hex(HOST_TOKEN));
    expect([...(rooms.calls[0]?.headers.values() ?? [])].join(' ')).not.toContain(HOST_TOKEN);
  });

  it('a wrong host token or an unknown code is 404 not_found', async () => {
    const rooms = await roomsAcceptingHostToken();
    const wrong = await call('DELETE', '/v1/rooms/BCDFGHJK', makeEnv({ ROOMS: rooms.ns }), {
      headers: { Authorization: `Bearer odh_${'c'.repeat(64)}` },
    });
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toEqual({ error: 'not_found' });

    const malformedCode = await call('DELETE', '/v1/rooms/NOPE', makeEnv({ ROOMS: rooms.ns }), { headers: { Authorization: `Bearer ${HOST_TOKEN}` } });
    expect(malformedCode.status).toBe(404);
    expect(rooms.calls).toHaveLength(1);
  });

  it('a missing or malformed host token is 401 invalid_token without reaching the DO', async () => {
    const rooms = await roomsAcceptingHostToken();
    for (const headers of [{}, { Authorization: `Bearer ${DEVICE_TOKEN}` }, { Authorization: 'Bearer odh_XYZ' }]) {
      const res = await call('DELETE', '/v1/rooms/BCDFGHJK', makeEnv({ ROOMS: rooms.ns }), { headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    }
    expect(rooms.calls).toEqual([]);
  });
});

describe('GET /s/:code', () => {
  it('an active room returns the invite page with pan join and no room data', async () => {
    const rooms = fakeRooms(defaultRoom);
    const res = await call('GET', '/s/bcdf-ghjk', makeEnv({ ROOMS: rooms.ns }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Content-Security-Policy')).toBe(HTML_CSP);
    expect(HTML_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    const text = await res.text();
    expect(text).toContain('You were invited to a shared Overdeck conversation');
    expect(text).toContain('pan join BCDFGHJK');
    expect(text).not.toContain('<script');
    expect(rooms.calls).toEqual([expect.objectContaining({ name: 'BCDFGHJK', path: '/status', method: 'GET' })]);
  });

  it('an unknown code returns a 404 page that reveals nothing about the code', async () => {
    const rooms = fakeRooms(() => new Response(null, { status: 404 }));
    const res = await call('GET', '/s/BCDFGHJK', makeEnv({ ROOMS: rooms.ns }));
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const text = await res.text();
    expect(text).toContain('This share link has ended or does not exist.');
    expect(text).not.toContain('BCDFGHJK');
    expect(text).not.toContain('pan join');
  });

  it('an ended room and a malformed code both return the 404 page; a malformed code never reaches the DO', async () => {
    const ended = fakeRooms(() => Response.json({ status: 'ended' }));
    expect((await call('GET', '/s/BCDFGHJK', makeEnv({ ROOMS: ended.ns }))).status).toBe(404);

    const rooms = fakeRooms(defaultRoom);
    const malformed = await call('GET', '/s/%3Cscript%3E', makeEnv({ ROOMS: rooms.ns }));
    expect(malformed.status).toBe(404);
    expect(await malformed.text()).not.toContain('<script>');
    expect(rooms.calls).toEqual([]);
  });
});

describe('GET /v1/rooms/:code/host and /join (upgrade routes)', () => {
  const upgrade = (authorization: string) => ({ headers: { Upgrade: 'websocket', Authorization: authorization } });
  const HOST_AUTH = `Bearer odh_${'b'.repeat(64)}`;
  const DEVICE_AUTH = `Bearer ${DEVICE_TOKEN}`;

  it('without an Upgrade header both answer 426; with v other than 1 both answer 400 unsupported_protocol', async () => {
    for (const [path, auth] of [['host', HOST_AUTH], ['join', DEVICE_AUTH]] as const) {
      const plain = await call('GET', `/v1/rooms/BCDFGHJK/${path}?v=1`, makeEnv(), { headers: { Authorization: auth } });
      expect(plain.status).toBe(426);
      const wrongVersion = await call('GET', `/v1/rooms/BCDFGHJK/${path}?v=2`, makeEnv(), upgrade(auth));
      expect(wrongVersion.status).toBe(400);
      expect(await wrongVersion.json()).toEqual({ error: 'unsupported_protocol' });
    }
  });

  it('host forwards only the token hash; a non-101 DO reply is 404', async () => {
    const rooms = fakeRooms(() => new Response(null, { status: 404 }));
    const res = await call('GET', '/v1/rooms/bcdf-ghjk/host?v=1', makeEnv({ ROOMS: rooms.ns }), upgrade(HOST_AUTH));
    expect(res.status).toBe(404);
    expect(rooms.calls).toHaveLength(1);
    expect(rooms.calls[0]).toMatchObject({ name: 'BCDFGHJK', path: '/host' });
    expect(rooms.calls[0]?.headers.get(HDR_HOST_TOKEN_HASH)).toBe(await sha256Hex(`odh_${'b'.repeat(64)}`));
    expect(rooms.calls[0]?.headers.get('Authorization')).toBeNull();
  });

  it('host with a malformed token is 401; join with a non-device token is 401 without calling verifyDevice', async () => {
    const rooms = fakeRooms(defaultRoom);
    const account = fakeAccount();
    const env = makeEnv({ ROOMS: rooms.ns, ACCOUNT: account.binding });
    expect((await call('GET', '/v1/rooms/BCDFGHJK/host?v=1', env, upgrade(DEVICE_AUTH))).status).toBe(401);
    expect((await call('GET', '/v1/rooms/BCDFGHJK/join?v=1', env, upgrade(HOST_AUTH))).status).toBe(401);
    expect(account.calls).toEqual([]);
    expect(rooms.calls).toEqual([]);
  });

  it('join forwards the verified identity, never the bearer token', async () => {
    const rooms = fakeRooms(() => new Response(null, { status: 404 }));
    const res = await call('GET', '/v1/rooms/BCDFGHJK/join?v=1', makeEnv({ ROOMS: rooms.ns }), upgrade(DEVICE_AUTH));
    expect(res.status).toBe(404);
    expect(JSON.parse(rooms.calls[0]?.headers.get('X-Share-Identity') ?? '')).toEqual({
      githubId: 42,
      login: 'octo',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
    });
    expect(rooms.calls[0]?.headers.get('Authorization')).toBeNull();
  });
});

describe('security headers', () => {
  it('every response carries Cache-Control: no-store and X-Content-Type-Options: nosniff', () => {
    expect(seen.length).toBeGreaterThanOrEqual(30);
    for (const res of seen) {
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false);
    }
  });
});
