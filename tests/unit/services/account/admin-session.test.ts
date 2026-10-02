import { describe, expect, it } from 'vitest';
import { ADMIN_SESSION_TTL_MS, CANCELLED_MESSAGE, NOT_OPERATOR_MESSAGE, REQUEST_REJECTED_MESSAGE, requireOwnerSession } from '../../../../services/account/src/admin/session.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import type { GitHubIdentity } from '../../../../services/account/src/github.ts';
import { githubMock } from './helpers/github-mock.ts';
import { call, dbOf, form, makeDeps, makeEnv, makeRc, TEST_BASE_URL, TEST_OWNER_GITHUB_ID, type TestDeps } from './helpers/harness.ts';

const OWNER: GitHubIdentity = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' };

function setup(identity: GitHubIdentity = OWNER, envOverrides: Partial<Env> = {}) {
  const env = makeEnv(envOverrides);
  const deps = makeDeps({ now: Date.UTC(2026, 9, 1, 12), fetch: githubMock({ identity }).fetch });
  return { env, deps, rc: makeRc({ env, deps }) };
}

/** POST /admin/login then the GitHub callback; returns the callback response. */
async function adminSignIn(env: Env, deps: TestDeps, query = 'code=gh') {
  const login = await call('POST', '/admin/login', { env, deps, ip: '203.0.113.5' });
  expect(login.status).toBe(302);
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(login.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  return call('GET', `/auth/github/callback?${query}&state=${state}`, { env, deps, ip: '203.0.113.5', headers: { Cookie: `__Host-od_state=${state}` } });
}

function sessionCookie(res: Response): string {
  return /__Host-od_admin=([0-9a-f]{64});/.exec(res.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
}

async function csrfFor(env: Env): Promise<string> {
  return (await dbOf(env).prepare('SELECT csrf_token FROM admin_sessions').first<string>('csrf_token')) ?? '';
}

describe('admin sign-in and session (PAN-4293 account-admin-session)', () => {
  it('/admin* is 503 when OWNER_GITHUB_ID is unset', async () => {
    const { env, deps } = setup(OWNER, { OWNER_GITHUB_ID: undefined });
    for (const [method, path] of [['GET', '/admin'], ['POST', '/admin/login'], ['POST', '/admin/logout']] as const) {
      const res = await call(method, path, { env, deps });
      expect(res.status, path).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_configured', missing: ['OWNER_GITHUB_ID'] });
    }
  });

  it('the owner identity gets a __Host-od_admin cookie with the D-20 attributes and a 302 to /admin; only a hash is stored', async () => {
    const { env, deps } = setup();
    const res = await adminSignIn(env, deps);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin');
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toContain(`__Host-od_admin=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
    expect(setCookies.some((c) => c.startsWith('__Host-od_state=;'))).toBe(true);

    const rows = (await dbOf(env).prepare('SELECT * FROM admin_sessions').all<Record<string, unknown>>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ github_id: TEST_OWNER_GITHUB_ID, created_at: deps.now(), expires_at: deps.now() + ADMIN_SESSION_TTL_MS });
    expect(rows[0]?.session_hash).not.toBe(cookie);
    expect(String(rows[0]?.csrf_token)).toMatch(/^[0-9a-f]{32}$/);

    const rc = makeRc({ env, deps });
    const owner = await requireOwnerSession(new Request(`${TEST_BASE_URL}/admin`, { headers: { Cookie: `__Host-od_admin=${cookie}` } }), rc);
    expect(owner.ok).toBe(true);
    if (owner.ok) expect(owner.session).toMatchObject({ githubId: TEST_OWNER_GITHUB_ID, csrfToken: rows[0]?.csrf_token });
  });

  it('a non-owner identity gets the 403 page and leaves no session row and no pending row', async () => {
    const { env, deps } = setup({ githubId: 4242, login: 'intruder' });
    const res = await adminSignIn(env, deps);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(NOT_OPERATOR_MESSAGE);
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain('__Host-od_admin=');
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM admin_sessions').first<number>('n')).toBe(0);
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM pending_attempts').first<number>('n')).toBe(0);
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM users').first<number>('n')).toBe(0);
  });

  it('a missing, unknown, expired or re-owned session yields the sign-in page', async () => {
    const { env, deps } = setup();
    const cookie = sessionCookie(await adminSignIn(env, deps));
    const rc = makeRc({ env, deps });
    const req = (c: string | null) => new Request(`${TEST_BASE_URL}/admin`, { headers: c === null ? {} : { Cookie: `__Host-od_admin=${c}` } });

    for (const c of [null, 'f'.repeat(64), 'short']) {
      const result = await requireOwnerSession(req(c), rc);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(200);
        expect(await result.response.text()).toContain('Sign in with GitHub');
        expect(result.response.headers.get('Set-Cookie')).toContain('__Host-od_admin=; ');
      }
    }
    expect((await requireOwnerSession(req(cookie), rc)).ok).toBe(true);
    deps.clock.advance(ADMIN_SESSION_TTL_MS);
    expect((await requireOwnerSession(req(cookie), rc)).ok).toBe(false);

    // The session's GitHub id no longer matches a changed OWNER_GITHUB_ID.
    deps.clock.advance(-ADMIN_SESSION_TTL_MS);
    const otherOwner = makeRc({ env: makeEnv({ DB: env.DB, OWNER_GITHUB_ID: '999' }), deps });
    expect((await requireOwnerSession(req(cookie), otherOwner)).ok).toBe(false);
  });

  it('an admin POST with a wrong csrf or a foreign Origin is 403; the correct pair is accepted and logout deletes the session', async () => {
    const { env, deps } = setup();
    const cookie = sessionCookie(await adminSignIn(env, deps));
    const csrf = await csrfFor(env);
    const post = (fields: Record<string, string>, origin: string | null) =>
      call('POST', '/admin/logout', {
        env,
        deps,
        headers: { Cookie: `__Host-od_admin=${cookie}`, ...(origin === null ? {} : { Origin: origin }), ...form(fields).headers },
        body: form(fields).body,
      });

    const wrongCsrf = await post({ csrf: 'nope' }, TEST_BASE_URL);
    expect(wrongCsrf.status).toBe(403);
    expect(await wrongCsrf.text()).toContain(REQUEST_REJECTED_MESSAGE);
    expect((await post({}, TEST_BASE_URL)).status).toBe(403);
    expect((await post({ csrf }, 'https://evil.example')).status).toBe(403);
    expect((await post({ csrf }, null)).status).toBe(403);
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM admin_sessions').first<number>('n')).toBe(1);

    const noSession = await call('POST', '/admin/logout', { env, deps, headers: { Origin: TEST_BASE_URL, ...form({ csrf }).headers }, body: form({ csrf }).body });
    expect(noSession.status).toBe(200);
    expect(await noSession.text()).toContain('Sign in with GitHub');

    const ok = await post({ csrf }, TEST_BASE_URL);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('Location')).toBe('/admin');
    expect(ok.headers.get('Set-Cookie')).toBe('__Host-od_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM admin_sessions').first<number>('n')).toBe(0);
    expect((await post({ csrf }, TEST_BASE_URL)).status).toBe(200);
  });

  it('cancelling on GitHub shows the sign-in page with the cancelled notice', async () => {
    const { env, deps } = setup();
    const res = await adminSignIn(env, deps, 'error=access_denied');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(CANCELLED_MESSAGE);
    expect(await dbOf(env).prepare('SELECT COUNT(*) AS n FROM admin_sessions').first<number>('n')).toBe(0);
  });

  it('POST /admin/login is rate limited to 10 per 10 minutes per IP', async () => {
    const { env, deps } = setup();
    for (let i = 0; i < 10; i++) expect((await call('POST', '/admin/login', { env, deps, ip: '203.0.113.9' })).status).toBe(302);
    const limited = await call('POST', '/admin/login', { env, deps, ip: '203.0.113.9' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Content-Type')).toContain('text/html');
  });
});
