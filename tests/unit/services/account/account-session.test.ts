import { describe, expect, it } from 'vitest';
import { ACCESS_REMOVED_MESSAGE, ACCOUNT_SESSION_TTL_MS, DELETING_MESSAGE } from '../../../../services/account/src/account-page/session.ts';
import { CANCELLED_MESSAGE, REQUEST_REJECTED_MESSAGE } from '../../../../services/account/src/admin/session.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import type { GitHubIdentity } from '../../../../services/account/src/github.ts';
import { makeAccountClient } from './helpers/account.ts';
import { githubMock } from './helpers/github-mock.ts';
import { call, dbOf, makeDeps, makeEnv, TEST_BASE_URL, TEST_OWNER_GITHUB_ID, type TestDeps } from './helpers/harness.ts';

const NOW = Date.UTC(2026, 10, 15, 12);
const OWNER: GitHubIdentity = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' };
const TESTER: GitHubIdentity = { githubId: 500, login: 'tess' };

function setup(identity: GitHubIdentity = OWNER) {
  const env = makeEnv();
  const deps = makeDeps({ now: NOW, fetch: githubMock({ identity }).fetch });
  return { env, deps };
}

/** POST /account/login then the GitHub callback; returns the callback response. */
async function accountSignIn(env: Env, deps: TestDeps, query = 'code=gh') {
  const login = await call('POST', '/account/login', { env, deps, ip: '203.0.113.7', headers: { Origin: TEST_BASE_URL } });
  expect(login.status).toBe(302);
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(login.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  return call('GET', `/auth/github/callback?${query}&state=${state}`, { env, deps, ip: '203.0.113.7', headers: { Cookie: `__Host-od_state=${state}` } });
}

function sessionCookie(res: Response): string {
  return /__Host-od_account=([0-9a-f]{64});/.exec(res.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
}

const count = (env: Env, table: string) => dbOf(env).prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n');

async function seedUser(env: Env, userId: string, who: GitHubIdentity, deletedAt: number | null = null) {
  await dbOf(env)
    .prepare('INSERT INTO users (user_id, github_id, github_login, created_at, deleted_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, who.githubId, who.login, 0, deletedAt)
    .run();
}

async function seedGrant(env: Env, who: GitHubIdentity, expiresAt: number | null) {
  await dbOf(env)
    .prepare("INSERT INTO grants (github_id, github_login, granted_at, expires_at, granted_via) VALUES (?, ?, ?, ?, 'admin-add')")
    .bind(who.githubId, who.login, 0, expiresAt)
    .run();
}

describe('account page sign-in and web session (PAN-4959 WI-4)', () => {
  it('GET /account without a cookie renders the Sign in with GitHub form posting to /account/login', async () => {
    const { env, deps } = setup();
    const res = await call('GET', '/account', { env, deps });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<form method="post" action="/account/login"><button type="submit">Sign in with GitHub</button></form>');
    expect(body).toContain('Your Overdeck account');
  });

  it('refuses POST /account/login from another origin', async () => {
    const { env, deps } = setup();
    const res = await call('POST', '/account/login', { env, deps, headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(REQUEST_REJECTED_MESSAGE);
    expect(await count(env, 'auth_requests')).toBe(0);
  });

  it('an allowlisted sign-in sets __Host-od_account with the NFR-3 attributes and stores one hashed session row', async () => {
    const { env, deps } = setup(TESTER);
    await seedGrant(env, TESTER, null);
    const res = await accountSignIn(env, deps);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account');
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers.getSetCookie()).toContain(`__Host-od_account=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);

    const userId = await dbOf(env).prepare('SELECT user_id FROM users WHERE github_id = ?').bind(TESTER.githubId).first<string>('user_id');
    const rows = (await dbOf(env).prepare('SELECT * FROM user_sessions').all<Record<string, unknown>>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: userId, created_at: NOW, expires_at: NOW + ACCOUNT_SESSION_TTL_MS });
    expect(rows[0]?.session_hash).not.toBe(cookie);
    expect(String(rows[0]?.csrf_token)).toMatch(/^[0-9a-f]{32}$/);

    const page = await call('GET', '/account', { env, deps, headers: { Cookie: `__Host-od_account=${cookie}` } });
    expect(await page.text()).toContain('Signed in as tess (GitHub id 500)');
  });

  it('the owner signs in without a grant row', async () => {
    const { env, deps } = setup(OWNER);
    const res = await accountSignIn(env, deps);
    expect(res.status).toBe(302);
    expect(sessionCookie(res)).toMatch(/^[0-9a-f]{64}$/);
    expect(await count(env, 'user_sessions')).toBe(1);
  });

  it('a GitHub id with no grant gets the invite-only page and leaves no session, user or pending-attempt row', async () => {
    const { env, deps } = setup({ githubId: 4242, login: 'stranger' });
    const res = await accountSignIn(env, deps);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Invite-only');
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain('__Host-od_account=');
    expect(await count(env, 'pending_attempts')).toBe(0);
    expect(await count(env, 'users')).toBe(0);
    expect(await count(env, 'user_sessions')).toBe(0);
  });

  it('a user whose grant expired still gets a web session (D-9)', async () => {
    const { env, deps } = setup(TESTER);
    await seedUser(env, 'u-expired', TESTER);
    await seedGrant(env, TESTER, NOW - 1);
    const res = await accountSignIn(env, deps);
    expect(res.status).toBe(302);
    expect(sessionCookie(res)).toMatch(/^[0-9a-f]{64}$/);
    expect(await dbOf(env).prepare('SELECT user_id FROM user_sessions').first<string>('user_id')).toBe('u-expired');
    expect(await count(env, 'pending_attempts')).toBe(0);
  });

  it('an expired grant without a users row gets the invite-only page', async () => {
    const { env, deps } = setup(TESTER);
    await seedGrant(env, TESTER, NOW - 1);
    const res = await accountSignIn(env, deps);
    expect(res.status).toBe(403);
    expect(await count(env, 'user_sessions')).toBe(0);
  });

  it('an account being deleted gets 403 "This account is being deleted." whether or not its grant is still active', async () => {
    for (const expiresAt of [null, NOW - 1]) {
      const { env, deps } = setup(TESTER);
      await seedUser(env, 'u-deleting', TESTER, NOW - 1000);
      await seedGrant(env, TESTER, expiresAt);
      const res = await accountSignIn(env, deps);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain(DELETING_MESSAGE);
      expect(await count(env, 'user_sessions')).toBe(0);
    }
  });

  it('a cancelled GitHub leg shows the sign-in page with the cancelled notice', async () => {
    const { env, deps } = setup();
    const res = await accountSignIn(env, deps, 'error=access_denied');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(CANCELLED_MESSAGE);
  });

  it('POST /account/logout without csrf or from another origin is 403 and keeps the row; with both it deletes it', async () => {
    const { env, deps } = setup();
    const client = await makeAccountClient(env, deps, 'u-owner');
    const noCsrf = await client.post('/account/logout', {}, { csrf: null });
    expect(noCsrf.status).toBe(403);
    expect(await noCsrf.text()).toContain(REQUEST_REJECTED_MESSAGE);
    expect((await client.post('/account/logout', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect(await count(env, 'user_sessions')).toBe(1);

    const res = await client.post('/account/logout');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/account');
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-od_account=;/);
    expect(await count(env, 'user_sessions')).toBe(0);
  });

  it('an expired session, or one of a deleting user, renders the sign-in page', async () => {
    const { env, deps } = setup();
    const client = await makeAccountClient(env, deps, 'u-owner');
    deps.clock.advance(ACCOUNT_SESSION_TTL_MS);
    expect(await (await client.get()).text()).toContain('Sign in with GitHub');

    const fresh = await makeAccountClient(env, deps, 'u-owner');
    await dbOf(env).prepare('UPDATE users SET deleted_at = ? WHERE user_id = ?').bind(deps.now(), 'u-owner').run();
    expect(await (await fresh.get()).text()).toContain('Sign in with GitHub');
  });

  it('a session whose grant was revoked renders "Access to this account was removed." and is deleted', async () => {
    const { env, deps } = setup();
    const client = await makeAccountClient(env, deps, 'u-tess', TESTER);
    const res = await client.get();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(ACCESS_REMOVED_MESSAGE);
    expect(await count(env, 'user_sessions')).toBe(0);
  });
});
