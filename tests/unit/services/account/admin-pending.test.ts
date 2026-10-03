import { describe, expect, it } from 'vitest';
import { ALLOW_SEMANTICS_MESSAGE } from '../../../../services/account/src/admin/screen.ts';
import { addGrant, getActiveGrant, getPendingAttempt, recordPendingAttempt } from '../../../../services/account/src/grants.ts';
import { makeAdminClient } from './helpers/admin.ts';
import { githubMock } from './helpers/github-mock.ts';
import { call, dbOf, makeDeps, makeEnv, makeRc, TEST_OWNER_GITHUB_ID } from './helpers/harness.ts';

const NOW = Date.UTC(2026, 9, 1, 12);
const HOUR = 3_600_000;
const START = '/auth/start?redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2Fcb&state=s1&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&platform=linux-x64&environment_id=11111111-2222-4333-8444-555555555555';

async function setup(identity = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' }) {
  const env = makeEnv();
  const deps = makeDeps({ now: NOW, fetch: githubMock({ identity }).fetch });
  const rc = makeRc({ env, deps });
  const admin = await makeAdminClient(env, deps);
  return { env, deps, rc, admin, db: dbOf(env) };
}

/** Runs the PKCE start + GitHub callback and returns the loopback redirect. */
async function pkceSignIn(env: ReturnType<typeof makeEnv>, deps: ReturnType<typeof makeDeps>) {
  const start = await call('GET', START, { env, deps });
  const state = /__Host-od_state=([0-9a-f]{64});/.exec(start.headers.get('Set-Cookie') ?? '')?.[1] ?? '';
  const cb = await call('GET', `/auth/github/callback?code=gh&state=${state}`, { env, deps, headers: { Cookie: `__Host-od_state=${state}` } });
  return new URL(cb.headers.get('Location') ?? '');
}

describe('admin screen: pending attempts and deletions (PAN-4293 account-admin-pending-screen)', () => {
  it('lists pending attempts with login, first/last seen, attempts and flow, plus the D-14 sentence', async () => {
    const { rc, deps, admin } = await setup();
    await recordPendingAttempt(rc, 4242, 'stranger', 'pkce');
    deps.clock.advance(2 * HOUR);
    await recordPendingAttempt(rc, 4242, 'stranger', 'device');
    const page = await (await admin.get()).text();
    expect(page).toContain('Pending sign-in attempts');
    expect(page).toContain(ALLOW_SEMANTICS_MESSAGE);
    expect(page).toContain('<a href="https://github.com/stranger">stranger</a>');
    expect(page).toContain('<td>4242</td>');
    expect(page).toContain('<td>2026-10-01 12:00 UTC</td>');
    expect(page).toContain('<td>2026-10-01 14:00 UTC</td>');
    expect(page).toContain('<td>2</td>');
    expect(page).toContain('<td>device</td>');
    expect(page).toContain('action="/admin/pending/4242/allow"');
    expect(page).toContain('No accounts allowlisted yet.');
  });

  it('Allow creates a tester grant via admin-allow-pending with the default cap, removes the pending row, and the next PKCE sign-in succeeds', async () => {
    const stranger = { githubId: 4242, login: 'stranger' };
    const { env, deps, rc, admin, db } = await setup(stranger);
    const refused = await pkceSignIn(env, deps);
    expect(refused.searchParams.get('error_description')).toBe('invite_only');
    expect(await getPendingAttempt(rc, 4242)).toMatchObject({ attempts: 1 });

    const res = await admin.post('/admin/pending/4242/allow');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin');
    expect(await db.prepare('SELECT * FROM grants WHERE github_id = ?').bind(4242).first()).toMatchObject({
      github_login: 'stranger',
      granted_via: 'admin-allow-pending',
      entitlement: 'tester',
      storage_cap_bytes: null,
      expires_at: null,
      note: null,
      granted_at: NOW,
    });
    expect(await getPendingAttempt(rc, 4242)).toBeNull();
    expect(await getActiveGrant(rc, 4242)).not.toBeNull();

    const allowed = await pkceSignIn(env, deps);
    expect(allowed.searchParams.get('code')).toMatch(/^odc_/);
    expect(allowed.searchParams.get('error')).toBeNull();
    const page = await (await admin.get()).text();
    expect(page).toContain('No pending attempts.');
    expect(page).toContain('<td>5 GB</td>');
  });

  it('Allow on a missing or malformed id is the 404 page and writes nothing', async () => {
    const { admin, db } = await setup();
    const gone = await admin.post('/admin/pending/777/allow');
    expect(gone.status).toBe(404);
    expect(await gone.text()).toContain('pending attempt is gone');
    expect((await admin.post('/admin/pending/abc/allow')).status).toBe(404);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM grants').first<number>('n')).toBe(0);
    expect((await admin.post('/admin/pending/777/allow', {}, { csrf: 'wrong' })).status).toBe(403);
  });

  it('lists deletions in progress; a job requested 25 hours ago is overdue, one requested 2 hours ago is not', async () => {
    const { admin, db } = await setup();
    await db.prepare("INSERT INTO deletion_jobs (user_id, requested_at, holders_pending, attempts, last_error) VALUES ('u-old', ?, '[\"vault\"]', 3, 'vault down'), ('u-new', ?, '[\"vault\"]', 1, NULL), ('u-done', ?, '[]', 0, NULL)")
      .bind(NOW - 25 * HOUR, NOW - 2 * HOUR, NOW - 30 * HOUR)
      .run();
    await db.prepare("UPDATE deletion_jobs SET completed_at = ? WHERE user_id = 'u-done'").bind(NOW - HOUR).run();
    const page = await (await admin.get()).text();
    expect(page).toContain('Account deletions in progress');
    expect(page).toContain('<td>u-old</td>');
    expect(page).toContain('<span class="warn">25 h, overdue</span>');
    expect(page).toContain('<td>vault down</td>');
    expect(page).toContain('<td>u-new</td>');
    expect(page).toContain('<td>2 h</td>');
    expect(page).not.toContain('u-done');
    expect(page.match(/overdue/g)).toHaveLength(1);
  });

  it('the pending table escapes logins and the sections render with grants present', async () => {
    const { rc, admin } = await setup();
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    await recordPendingAttempt(rc, 5, '<img src=x onerror=alert(1)>', 'device');
    const page = await (await admin.get()).text();
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(page).toContain('None.');
  });
});
