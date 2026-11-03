import { describe, expect, it } from 'vitest';
import type { AccountBinding, AccountRedeemResult, AccountVerifyResult } from '../../../../services/share/src/account.ts';
import type { Deps, Env } from '../../../../services/share/src/env.ts';
import { handle } from '../../../../services/share/src/routes.ts';
import { ENV_COOKIE, seal, SESSION_COOKIE, SIGNIN_COOKIE, unseal } from '../../../../services/share/src/web-auth.ts';

const BASE = 'https://share.test';
const ACCOUNT_BASE = 'https://account.test';
const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);
const CODE = 'BCDFGHJK';
const TOKEN = 'odd_' + 'a'.repeat(64);
const START = 1_700_000_000_000;
const ENV_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeDeps() {
  let now = START;
  let seq = 0;
  const deps: Deps & { advance(ms: number): void } = {
    now: () => now,
    fetch: () => Promise.reject(new Error('unexpected outbound fetch')),
    randomBytes: (n) => Uint8Array.from({ length: n }, () => (seq++ * 37) % 256),
    advance: (ms) => {
      now += ms;
    },
  };
  return deps;
}

interface AccountScript {
  verify?: AccountVerifyResult | Error;
  redeem?: AccountRedeemResult | Error;
}

function fakeAccount(script: AccountScript = {}) {
  const calls = { verify: [] as string[], redeem: [] as Array<{ code: string; codeVerifier: string; redirectUri: string }>, signOut: [] as string[] };
  const binding: AccountBinding = {
    verifyDevice: async (token) => {
      calls.verify.push(token);
      const r = script.verify ?? { ok: true, userId: 'u1', githubId: 42, githubLogin: 'octo', deviceId: 'd1' };
      if (r instanceof Error) throw r;
      return r;
    },
    redeemWebCode: async (input) => {
      calls.redeem.push(input);
      const r = script.redeem ?? { ok: true, accessToken: TOKEN, deviceId: 'd1', label: 'Web browser' };
      if (r instanceof Error) throw r;
      return r;
    },
    signOutDevice: async (token) => {
      calls.signOut.push(token);
      return { ok: true };
    },
  };
  return { binding, calls };
}

function makeEnv(account: AccountBinding, overrides: Partial<Env> = {}): Env {
  return {
    ROOMS: {} as DurableObjectNamespace,
    ACCOUNT: account,
    PUBLIC_BASE_URL: BASE,
    ACCOUNT_BASE_URL: ACCOUNT_BASE,
    WEB_SESSION_KEY: KEY,
    ...overrides,
  };
}

function call(env: Env, deps: Deps, method: string, path: string, init: RequestInit = {}): Promise<Response> {
  return handle(new Request(`${BASE}${path}`, { method, redirect: 'manual', ...init }), env, deps);
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieNamed(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

function cookieValue(res: Response, name: string): string {
  return (cookieNamed(res, name) ?? '').split(';')[0]?.slice(name.length + 1) ?? '';
}

/** Runs /auth/signin and returns the sign-in cookie value and the state sent to the account Worker. */
async function startSignIn(env: Env, deps: Deps) {
  const res = await call(env, deps, 'GET', `/auth/signin?code=${CODE.toLowerCase()}`);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location') ?? '');
  return { res, location, signin: cookieValue(res, SIGNIN_COOKIE), state: location.searchParams.get('state') ?? '' };
}

async function sessionCookieFor(deps: Deps, token = TOKEN, iat = deps.now()): Promise<string> {
  return `${SESSION_COOKIE}=${await seal(KEY, { v: 1, token, iat }, deps)}`;
}

describe('sealed cookies (PAN-4481 share-web-session)', () => {
  it('seal/unseal round-trips; a tampered value or the wrong key yields null', async () => {
    const deps = makeDeps();
    const sealed = await seal(KEY, { v: 1, token: TOKEN, iat: 5 }, deps);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(TOKEN);
    expect(await unseal(KEY, sealed)).toEqual({ v: 1, token: TOKEN, iat: 5 });

    const last = sealed.slice(-1) === 'A' ? 'B' : 'A';
    expect(await unseal(KEY, sealed.slice(0, -1) + last)).toBeNull();
    expect(await unseal(OTHER_KEY, sealed)).toBeNull();
    expect(await unseal(KEY, 'not+base64url')).toBeNull();
    expect(await unseal(KEY, '')).toBeNull();
  });
});

describe('browser sign-in (PAN-4481 share-web-session)', () => {
  it('GET /auth/signin sets the sign-in and environment cookies and 302s to the account Worker with platform=web', async () => {
    const deps = makeDeps();
    const { res, location, signin, state } = await startSignIn(makeEnv(fakeAccount().binding), deps);
    expect(location.origin + location.pathname).toBe(`${ACCOUNT_BASE}/auth/start`);
    expect(location.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/callback`);
    expect(location.searchParams.get('platform')).toBe('web');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).toMatch(/^[0-9a-f]{32}$/);
    expect(location.searchParams.get('environment_id')).toMatch(ENV_ID_RE);

    expect(cookieNamed(res, SIGNIN_COOKIE)).toMatch(/; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600$/);
    expect(cookieNamed(res, ENV_COOKIE)).toMatch(/; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=34560000$/);
    expect(cookieValue(res, ENV_COOKIE)).toBe(location.searchParams.get('environment_id'));
    expect(await unseal(KEY, signin)).toMatchObject({ v: 1, state, code: CODE, iat: START });
  });

  it('GET /auth/signin reuses a valid environment cookie and refuses an invalid code', async () => {
    const deps = makeDeps();
    const env = makeEnv(fakeAccount().binding);
    const envId = '11111111-2222-4333-8444-555555555555';
    const res = await call(env, deps, 'GET', `/auth/signin?code=${CODE}`, { headers: { Cookie: `${ENV_COOKIE}=${envId}` } });
    expect(new URL(res.headers.get('Location') ?? '').searchParams.get('environment_id')).toBe(envId);

    const bad = await call(env, deps, 'GET', '/auth/signin?code=nope');
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('This share link is not valid.');
    expect(cookieNamed(bad, SIGNIN_COOKIE)).toBeUndefined();
  });

  it('GET /auth/callback with the matching state redeems the code and sets a Strict session cookie', async () => {
    const deps = makeDeps();
    const account = fakeAccount();
    const env = makeEnv(account.binding);
    const { signin, state } = await startSignIn(env, deps);
    const sealedVerifier = (await unseal<{ verifier: string }>(KEY, signin))?.verifier;

    const res = await call(env, deps, 'GET', `/auth/callback?code=odc_x&state=${state}`, { headers: { Cookie: `${SIGNIN_COOKIE}=${signin}` } });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/s/${CODE}`);
    expect(account.calls.redeem).toEqual([{ code: 'odc_x', codeVerifier: sealedVerifier, redirectUri: `${BASE}/auth/callback` }]);
    expect(cookieNamed(res, SESSION_COOKIE)).toMatch(/; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=2592000$/);
    expect(cookieNamed(res, SIGNIN_COOKIE)).toMatch(/=; .*Max-Age=0$/);
    expect(await unseal(KEY, cookieValue(res, SESSION_COOKIE))).toEqual({ v: 1, token: TOKEN, iat: START });
    expect(cookieValue(res, SESSION_COOKIE)).not.toContain(TOKEN);
  });

  it('a mismatched state, a missing cookie and an expired sign-in cookie give the expired page and redeem nothing', async () => {
    const deps = makeDeps();
    const account = fakeAccount();
    const env = makeEnv(account.binding);
    const { signin, state } = await startSignIn(env, deps);
    const cookie = { Cookie: `${SIGNIN_COOKIE}=${signin}` };

    const wrong = await call(env, deps, 'GET', '/auth/callback?code=odc_x&state=other', { headers: cookie });
    expect(wrong.status).toBe(400);
    const text = await wrong.text();
    expect(text).toContain('This sign-in link expired or was already used.');
    expect(text).toContain(`href="/s/${CODE}"`);
    expect(cookieNamed(wrong, SIGNIN_COOKIE)).toMatch(/Max-Age=0$/);

    const missing = await call(env, deps, 'GET', `/auth/callback?code=odc_x&state=${state}`);
    expect(missing.status).toBe(400);
    expect(await missing.text()).not.toContain('href="/s/');

    deps.advance(601_000);
    const expired = await call(env, deps, 'GET', `/auth/callback?code=odc_x&state=${state}`, { headers: cookie });
    expect(expired.status).toBe(400);
    expect(await expired.text()).toContain('expired or was already used');
    expect(account.calls.redeem).toEqual([]);
  });

  it('account errors map to the invite-only, cancelled, deleting, expired and unavailable pages', async () => {
    const cases: Array<{ query: string; script?: AccountScript; status: number; text: string }> = [
      { query: 'error=access_denied&error_description=invite_only', status: 403, text: 'not on the overdeck.ai invite list yet' },
      { query: 'error=access_denied&error_description=github_denied', status: 400, text: 'GitHub sign-in was cancelled.' },
      { query: 'error=access_denied&error_description=account_deleting', status: 403, text: 'This overdeck.ai account is being deleted.' },
      { query: 'error=server_error', status: 400, text: 'expired or was already used' },
      { query: 'code=odc_x', script: { redeem: { ok: false, error: 'access_denied' } }, status: 403, text: 'Ask the person who shared this link to get you added' },
      { query: 'code=odc_x', script: { redeem: { ok: false, error: 'invalid_grant' } }, status: 400, text: 'expired or was already used' },
      { query: 'code=odc_x', script: { redeem: new Error('binding down') }, status: 503, text: 'sign-in is unavailable right now' },
    ];
    for (const c of cases) {
      const deps = makeDeps();
      const env = makeEnv(fakeAccount(c.script).binding);
      const { signin, state } = await startSignIn(env, deps);
      const res = await call(env, deps, 'GET', `/auth/callback?${c.query}&state=${state}`, { headers: { Cookie: `${SIGNIN_COOKIE}=${signin}` } });
      expect(res.status, c.query).toBe(c.status);
      const body = await res.text();
      expect(body, c.query).toContain(c.text);
      expect(body, c.query).toContain(`href="/s/${CODE}"`);
      expect(cookieNamed(res, SESSION_COOKIE), c.query).toBeUndefined();
      expect(res.headers.get('Content-Security-Policy'), c.query).not.toContain('script-src');
    }
  });
});

describe('GET /v1/web/session (PAN-4481 share-web-session)', () => {
  it('reports signedIn false without a cookie and for a tampered or 30-day-old cookie', async () => {
    const deps = makeDeps();
    const account = fakeAccount();
    const env = makeEnv(account.binding);
    expect(await (await call(env, deps, 'GET', '/v1/web/session')).json()).toEqual({ signedIn: false });
    const tampered = (await sessionCookieFor(deps)).slice(0, -2) + 'zz';
    expect(await (await call(env, deps, 'GET', '/v1/web/session', { headers: { Cookie: tampered } })).json()).toEqual({ signedIn: false });
    const old = await sessionCookieFor(deps, TOKEN, START - 2_592_000_000);
    expect(await (await call(env, deps, 'GET', '/v1/web/session', { headers: { Cookie: old } })).json()).toEqual({ signedIn: false });
    expect(account.calls.verify).toEqual([]);
  });

  it('a valid session reports the identity with an avatar URL built from the GitHub id', async () => {
    const deps = makeDeps();
    const account = fakeAccount();
    const res = await call(makeEnv(account.binding), deps, 'GET', '/v1/web/session', { headers: { Cookie: await sessionCookieFor(deps) } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, githubId: 42, login: 'octo', avatarUrl: 'https://avatars.githubusercontent.com/u/42' });
    expect(account.calls.verify).toEqual([TOKEN]);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('grant_expired keeps the cookie; revoked, invalid and deleted clear it; an unreachable account service is 503', async () => {
    const deps = makeDeps();
    const cookie = { Cookie: await sessionCookieFor(deps) };

    const expired = await call(makeEnv(fakeAccount({ verify: { ok: false, error: 'grant_expired' } }).binding), deps, 'GET', '/v1/web/session', { headers: cookie });
    expect(await expired.json()).toEqual({ signedIn: false, reason: 'grant_expired' });
    expect(cookieNamed(expired, SESSION_COOKIE)).toBeUndefined();

    for (const error of ['invalid_token', 'device_revoked', 'account_deleted'] as const) {
      const res = await call(makeEnv(fakeAccount({ verify: { ok: false, error } }).binding), deps, 'GET', '/v1/web/session', { headers: cookie });
      expect(res.status, error).toBe(200);
      expect(await res.json(), error).toEqual({ signedIn: false });
      expect(cookieNamed(res, SESSION_COOKIE), error).toMatch(/=; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=0$/);
    }

    const down = await call(makeEnv(fakeAccount({ verify: new Error('down') }).binding), deps, 'GET', '/v1/web/session', { headers: cookie });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: 'account_unavailable' });

    const outdated = await call(makeEnv(fakeAccount({ verify: { ok: true, userId: 'u1', githubId: 42, deviceId: 'd1' } }).binding), deps, 'GET', '/v1/web/session', { headers: cookie });
    expect(outdated.status).toBe(503);
    expect(await outdated.json()).toEqual({ error: 'account_service_outdated' });
  });
});

describe('POST /auth/signout (PAN-4481 share-web-session)', () => {
  function signOut(env: Env, deps: Deps, headers: Record<string, string>, code = CODE) {
    return call(env, deps, 'POST', '/auth/signout', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams({ code }).toString(),
    });
  }

  it('same-origin sign-out revokes the device, clears the session and 303s back to the room', async () => {
    const deps = makeDeps();
    const account = fakeAccount();
    const res = await signOut(makeEnv(account.binding), deps, { Origin: BASE, Cookie: await sessionCookieFor(deps) }, CODE.toLowerCase());
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(`/s/${CODE}`);
    expect(account.calls.signOut).toEqual([TOKEN]);
    expect(cookieNamed(res, SESSION_COOKIE)).toMatch(/=; .*Max-Age=0$/);
  });

  it('a missing or foreign Origin is 403 and never calls signOutDevice', async () => {
    const deps = makeDeps();
    const account = fakeAccount();
    const env = makeEnv(account.binding);
    const cookie = await sessionCookieFor(deps);
    for (const headers of [{ Cookie: cookie }, { Cookie: cookie, Origin: 'https://evil.test' }]) {
      const res = await signOut(env, deps, headers);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden_origin' });
    }
    expect(account.calls.signOut).toEqual([]);
  });

  it('an invalid code still clears the session and renders the 400 page', async () => {
    const deps = makeDeps();
    const res = await signOut(makeEnv(fakeAccount().binding), deps, { Origin: BASE, Cookie: await sessionCookieFor(deps) }, 'nope');
    expect(res.status).toBe(400);
    expect(cookieNamed(res, SESSION_COOKIE)).toMatch(/Max-Age=0$/);
  });
});

describe('web join is optional configuration (PAN-4481 NFR-6)', () => {
  it('without WEB_SESSION_KEY (or with a malformed one) every web route is 503 not_configured and /healthz reports web: false', async () => {
    const deps = makeDeps();
    for (const overrides of [{ WEB_SESSION_KEY: undefined }, { WEB_SESSION_KEY: 'short' }, { ACCOUNT_BASE_URL: undefined }]) {
      const env = makeEnv(fakeAccount().binding, overrides);
      for (const [method, path] of [
        ['GET', `/auth/signin?code=${CODE}`],
        ['GET', '/auth/callback?code=odc_x&state=s'],
        ['POST', '/auth/signout'],
        ['GET', '/v1/web/session'],
      ] as const) {
        const res = await call(env, deps, method, path, method === 'POST' ? { headers: { Origin: BASE } } : {});
        expect(res.status, `${method} ${path}`).toBe(503);
        expect((await res.json()) as { error: string }, `${method} ${path}`).toMatchObject({ error: 'not_configured' });
      }
      expect(await (await call(env, deps, 'GET', '/healthz')).json()).toMatchObject({ web: false });
    }
    const missing = await call(makeEnv(fakeAccount().binding, { WEB_SESSION_KEY: undefined, ACCOUNT_BASE_URL: undefined }), deps, 'GET', '/v1/web/session');
    expect(await missing.json()).toEqual({ error: 'not_configured', missing: ['ACCOUNT_BASE_URL', 'WEB_SESSION_KEY'] });
    expect(await (await call(makeEnv(fakeAccount().binding), deps, 'GET', '/healthz')).json()).toMatchObject({ web: true });
  });
});
