import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../../../../services/account/src/env.ts';
import { lookupUserByLogin, type GitHubIdentity } from '../../../../services/account/src/github.ts';
import { EXPIRED_LINK_MESSAGE, GITHUB_FAILED_MESSAGE, handleCallback, type PurposeHandlers } from '../../../../services/account/src/github-callback.ts';
import { addGrant, getPendingAttempt } from '../../../../services/account/src/grants.ts';
import { json } from '../../../../services/account/src/http.ts';
import { AUTH_REQUEST_TTL_MS, resolveSignIn, startGitHubLeg, STATE_COOKIE, type Payload } from '../../../../services/account/src/sign-in.ts';
import { dumpAllTables } from './helpers/d1.ts';
import { githubMock, MOCK_ACCESS_TOKEN, type GitHubMockOptions } from './helpers/github-mock.ts';
import { call, dbOf, makeDeps, makeEnv, makeRc, TEST_BASE_URL, TEST_OWNER_GITHUB_ID } from './helpers/harness.ts';

interface Seen {
  identity?: { purpose: string; payload: Payload; identity: GitHubIdentity };
  denied?: { purpose: string; payload: Payload };
}

function recordingHandlers(seen: Seen): PurposeHandlers {
  const make = (purpose: string) => ({
    async onIdentity(_rc: RequestContext, payload: Payload, identity: GitHubIdentity) {
      seen.identity = { purpose, payload, identity };
      return json({ handled: purpose }, 200);
    },
    async onDenied(_rc: RequestContext, payload: Payload) {
      seen.denied = { purpose, payload };
      return json({ denied: purpose }, 200);
    },
  });
  return { pkce: make('pkce'), device: make('device'), admin: make('admin') };
}

function setup(mock: GitHubMockOptions = {}) {
  const env = makeEnv();
  const gh = githubMock(mock);
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12), fetch: gh.fetch });
  const rc = makeRc({ env, deps });
  const seen: Seen = {};
  return { env, deps, rc, gh, seen, handlers: recordingHandlers(seen) };
}

/** Starts a leg and returns the state (from the cookie) plus a callback request builder. */
async function startLeg(rc: RequestContext, purpose: 'pkce' | 'device' | 'admin', payload: Payload) {
  const res = await startGitHubLeg(rc, purpose, payload);
  const cookie = res.headers.get('Set-Cookie') ?? '';
  const state = /__Host-od_state=([0-9a-f]+);/.exec(cookie)?.[1] ?? '';
  const location = new URL(res.headers.get('Location') ?? '');
  const callback = (query: Record<string, string>, cookieState: string | null = state) => {
    const url = new URL(`${TEST_BASE_URL}/auth/github/callback`);
    url.searchParams.set('state', state);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = {};
    if (cookieState !== null) headers.Cookie = `${STATE_COOKIE}=${cookieState}`;
    return new Request(url, { headers });
  };
  return { res, cookie, state, location, callback };
}

describe('GitHub leg (PAN-4293 account-github-leg)', () => {
  it('the authorize redirect carries scope=read:user, the callback URL and a state equal to the cookie', async () => {
    const { rc } = setup();
    const { res, cookie, state, location } = await startLeg(rc, 'pkce', { clientState: 'abc' });
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe(`${TEST_BASE_URL}/auth/github/callback`);
    expect(location.searchParams.get('allow_signup')).toBe('true');
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(location.searchParams.get('state')).toBe(state);
    expect(cookie).toBe(`__Host-od_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
    expect(dumpAllTables(dbOf(rc.env))).not.toContain(state);
  });

  it('missing cookie, mismatched cookie, expired row or replay → 400 page and the cookie is cleared', async () => {
    const { rc, deps, handlers, seen } = setup();
    const { callback } = await startLeg(rc, 'pkce', {});

    for (const req of [callback({ code: 'c' }, null), callback({ code: 'c' }, 'f'.repeat(64)), callback({ code: 'c' }, '')]) {
      const res = await handleCallback(req, rc, handlers);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(EXPIRED_LINK_MESSAGE);
      expect(res.headers.get('Set-Cookie')).toContain('__Host-od_state=; ');
      expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    }
    const noState = await handleCallback(new Request(`${TEST_BASE_URL}/auth/github/callback?code=c`), rc, handlers);
    expect(noState.status).toBe(400);

    deps.clock.advance(AUTH_REQUEST_TTL_MS);
    const expired = await handleCallback(callback({ code: 'c' }), rc, handlers);
    expect(expired.status).toBe(400);
    expect(seen.identity).toBeUndefined();

    const second = await startLeg(rc, 'device', { deviceCodeHash: 'h' });
    const ok = await handleCallback(second.callback({ code: 'c' }), rc, handlers);
    expect(ok.status).toBe(200);
    const replay = await handleCallback(second.callback({ code: 'c' }), rc, handlers);
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain(EXPIRED_LINK_MESSAGE);
  });

  it('success exchanges the code, reads /user and hands {githubId, login} plus the payload to the purpose handler', async () => {
    const { rc, gh, handlers, seen } = setup({ identity: { githubId: 583231, login: 'octocat' } });
    const { callback } = await startLeg(rc, 'pkce', { clientState: 'xyz', redirectUri: 'http://127.0.0.1:4567/cb' });
    const res = await handleCallback(callback({ code: 'the-code' }), rc, handlers);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handled: 'pkce' });
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(seen.identity).toEqual({ purpose: 'pkce', payload: { clientState: 'xyz', redirectUri: 'http://127.0.0.1:4567/cb' }, identity: { githubId: 583231, login: 'octocat' } });

    expect(gh.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://github.com/login/oauth/access_token', 'GET https://api.github.com/user']);
    const exchange = gh.calls[0]!;
    expect(exchange.headers.accept).toBe('application/json');
    expect(new URLSearchParams(exchange.body ?? '').get('code')).toBe('the-code');
    expect(new URLSearchParams(exchange.body ?? '').get('client_secret')).toBe('test-client-secret');
    expect(new URLSearchParams(exchange.body ?? '').get('redirect_uri')).toBe(`${TEST_BASE_URL}/auth/github/callback`);
    expect(gh.calls[1]!.headers.authorization).toBe(`Bearer ${MOCK_ACCESS_TOKEN}`);
    expect(gh.calls[1]!.headers['user-agent']).toBe('overdeck-account');

    const dump = dumpAllTables(dbOf(rc.env));
    expect(dump).not.toContain(MOCK_ACCESS_TOKEN);
    expect(dump).not.toContain('gho_');
  });

  it('GitHub error=access_denied dispatches to onDenied without calling GitHub', async () => {
    const { rc, gh, handlers, seen } = setup();
    const { callback } = await startLeg(rc, 'admin', {});
    const res = await handleCallback(callback({ error: 'access_denied', error_description: 'The user has denied your application access.' }), rc, handlers);
    expect(await res.json()).toEqual({ denied: 'admin' });
    expect(seen.denied).toEqual({ purpose: 'admin', payload: {} });
    expect(gh.calls).toHaveLength(0);
  });

  it('token-exchange failure, a missing code or a bad /user answer → 502 page', async () => {
    for (const mock of [{ tokenStatus: 401 }, { userStatus: 401 }, { identity: null }] as GitHubMockOptions[]) {
      const { rc, handlers, seen } = setup(mock);
      const { callback } = await startLeg(rc, 'pkce', {});
      const res = await handleCallback(callback({ code: 'c' }), rc, handlers);
      expect(res.status).toBe(502);
      expect(await res.text()).toContain(GITHUB_FAILED_MESSAGE);
      expect(seen.identity).toBeUndefined();
    }
    const { rc, handlers } = setup();
    const { callback } = await startLeg(rc, 'pkce', {});
    expect((await handleCallback(callback({}), rc, handlers)).status).toBe(502);
  });

  it('the route table reaches the dispatcher: a cold GET /auth/github/callback is the 400 page', async () => {
    const res = await call('GET', '/auth/github/callback?code=c&state=s');
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });
});

describe('resolveSignIn (D-11 gate)', () => {
  it('records a pending attempt and creates no users row for a non-allowlisted id', async () => {
    const { rc } = setup();
    expect(await resolveSignIn(rc, { githubId: 777, login: 'stranger' }, 'pkce')).toEqual({ allowed: false, reason: 'invite_only' });
    expect(await getPendingAttempt(rc, 777)).toMatchObject({ github_login: 'stranger', attempts: 1, last_flow: 'pkce' });
    expect(await dbOf(rc.env).prepare('SELECT COUNT(*) AS n FROM users').first<number>('n')).toBe(0);
  });

  it('creates the user on first sign-in, refreshes the login afterwards and keeps one row', async () => {
    const { rc, deps } = setup();
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    const first = await resolveSignIn(rc, { githubId: 100, login: 'alice' }, 'device');
    expect(first).toMatchObject({ allowed: true });
    const second = await resolveSignIn(rc, { githubId: 100, login: 'alice-new' }, 'pkce');
    expect(second).toEqual(first);
    const rows = (await dbOf(rc.env).prepare('SELECT github_login, created_at FROM users').all()).results;
    expect(rows).toEqual([{ github_login: 'alice-new', created_at: deps.now() }]);
    expect(await getPendingAttempt(rc, 100)).toBeNull();
  });

  it('the owner is allowed without a grant, and a deleting account is refused', async () => {
    const { rc, deps } = setup();
    const owner = await resolveSignIn(rc, { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' }, 'pkce');
    expect(owner.allowed).toBe(true);
    await dbOf(rc.env).prepare('UPDATE users SET deleted_at = ? WHERE github_id = ?').bind(deps.now(), TEST_OWNER_GITHUB_ID).run();
    expect(await resolveSignIn(rc, { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' }, 'pkce')).toEqual({ allowed: false, reason: 'account_deleting' });
  });
});

describe('lookupUserByLogin (D-9)', () => {
  it('maps 200, 404 and 403/429 to the admin form outcomes', async () => {
    const { rc } = setup({ users: { octocat: { status: 200, body: { id: 583231, login: 'octocat' } }, limited: { status: 403 }, busy: { status: 429 }, broken: { status: 500 } } });
    expect(await lookupUserByLogin(rc, 'octocat')).toEqual({ ok: true, identity: { githubId: 583231, login: 'octocat' } });
    expect(await lookupUserByLogin(rc, 'nobody-here')).toEqual({ ok: false, error: 'not_found' });
    expect(await lookupUserByLogin(rc, 'limited')).toEqual({ ok: false, error: 'rate_limited' });
    expect(await lookupUserByLogin(rc, 'busy')).toEqual({ ok: false, error: 'rate_limited' });
    expect(await lookupUserByLogin(rc, 'broken')).toEqual({ ok: false, error: 'upstream' });
  });
});
