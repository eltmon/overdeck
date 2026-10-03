import { describe, expect, it } from 'vitest';
import { formatCap, GITHUB_RATE_LIMIT_MESSAGE, parseAddForm, USER_NOT_FOUND_MESSAGE } from '../../../../services/account/src/admin/screen.ts';
import { mintDevice, verifyDeviceToken } from '../../../../services/account/src/devices.ts';
import { addGrant, getActiveGrant, getPendingAttempt, recordPendingAttempt } from '../../../../services/account/src/grants.ts';
import { makeAdminClient } from './helpers/admin.ts';
import { githubMock, type GitHubMockOptions } from './helpers/github-mock.ts';
import { dbOf, makeDeps, makeEnv, makeRc } from './helpers/harness.ts';

const NOW = Date.UTC(2026, 9, 1, 12);
const DAY = 86_400_000;

async function setup(users: GitHubMockOptions['users'] = {}) {
  const env = makeEnv();
  const deps = makeDeps({ now: NOW, fetch: githubMock({ users }).fetch });
  const rc = makeRc({ env, deps });
  const admin = await makeAdminClient(env, deps);
  return { env, deps, rc, admin, db: dbOf(env) };
}

describe('admin screen: accounts, add, revoke (PAN-4293 account-admin-grants-screen)', () => {
  it('renders the owner line and one row per grant with every column, newest first', async () => {
    const { env, rc, deps } = await setup();
    await addGrant(rc, 100, 'alice', { note: 'beta tester' }, 'admin-add');
    deps.clock.advance(DAY);
    // The 12-hour session planted by setup() has expired after a day; plant a fresh one.
    const admin = await makeAdminClient(env, deps);
    await addGrant(rc, 200, 'bob', { storageCapBytes: 2 * 1024 ** 3, expiresAt: NOW + 30 * DAY }, 'admin-allow-pending');
    await rc.env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u-bob', 200, 'bob', NOW).run();
    const bob = await mintDevice(rc, 'u-bob', 'linux-x64', '11111111-2222-4333-8444-555555555555');
    await verifyDeviceToken(rc, bob.token);

    const res = await admin.get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const page = await res.text();
    expect(page).toContain('Overdeck accounts (invite-only)');
    expect(page).toContain('Owner (always allowed): GitHub id 1');
    expect(page.indexOf('>bob<')).toBeLessThan(page.indexOf('>alice<'));
    expect(page).toContain('<a href="https://github.com/alice">alice</a>');
    expect(page).toContain('<td>100</td>');
    expect(page).toContain('<td>2026-10-01</td>');
    expect(page).toContain('<td>2026-10-02</td>');
    expect(page).toContain('<td>tester</td>');
    expect(page).toContain('<td>5 GB</td>');
    expect(page).toContain('<td>2 GB</td>');
    expect(page).toContain('<td>beta tester</td>');
    expect(page).toContain('<td>never</td>');
    expect(page).toContain('<td>2026-10-31</td>');
    expect(page).toContain(`<td>${new Date(deps.now()).toISOString().slice(0, 16).replace('T', ' ')} UTC</td>`);
    expect(page).toContain('<td>—</td>');
    expect(page).toContain('action="/admin/grants/100/revoke"');
    expect(page).toContain(`name="csrf" value="${admin.csrf}"`);
    expect(page).toContain('Add an account');
  });

  it('shows expired grants in the warning color and formats fractional caps', async () => {
    const { rc, admin } = await setup();
    await addGrant(rc, 100, 'alice', { expiresAt: NOW - 1 }, 'admin-add');
    const page = await (await admin.get()).text();
    expect(page).toContain('<span class="warn">expired</span> 2026-10-01');
    expect(formatCap(null)).toBe('5 GB');
    expect(formatCap(1536 * 1024 ** 2)).toBe('1.50 GB');
  });

  it('adding octocat with note, expiry and cap 2 stores the numeric id and bytes and removes the pending row', async () => {
    const { rc, admin, db } = await setup({ octocat: { status: 200, body: { id: 583231, login: 'octocat' } } });
    await recordPendingAttempt(rc, 583231, 'octocat', 'pkce');
    const res = await admin.post('/admin/grants', { username: 'octocat', note: 'beta', expires: '2026-12-31', cap_gb: '2' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/admin');
    const grant = await db.prepare('SELECT * FROM grants WHERE github_id = ?').bind(583231).first();
    expect(grant).toMatchObject({
      github_login: 'octocat',
      note: 'beta',
      storage_cap_bytes: 2147483648,
      expires_at: Date.UTC(2026, 11, 31, 23, 59, 59, 999),
      granted_via: 'admin-add',
      entitlement: 'tester',
      granted_at: NOW,
    });
    expect(await getPendingAttempt(rc, 583231)).toBeNull();

    // Optional fields empty: default cap and no expiry.
    expect((await admin.post('/admin/grants', { username: 'octocat', note: '', expires: '', cap_gb: '' })).status).toBe(303);
    expect(await db.prepare('SELECT storage_cap_bytes, expires_at, note FROM grants WHERE github_id = ?').bind(583231).first()).toEqual({ storage_cap_bytes: null, expires_at: null, note: null });
  });

  it('lookup 404 → "GitHub user not found" and no grant; 403 → the rate-limit message', async () => {
    const { admin, db } = await setup({ limited: { status: 403 } });
    const missing = await admin.post('/admin/grants', { username: 'nobody-here' });
    expect(missing.status).toBe(404);
    const page = await missing.text();
    expect(page).toContain(USER_NOT_FOUND_MESSAGE);
    expect(page).toContain('value="nobody-here"');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM grants').first<number>('n')).toBe(0);

    const limited = await admin.post('/admin/grants', { username: 'limited' });
    expect(limited.status).toBe(502);
    expect(await limited.text()).toContain(GITHUB_RATE_LIMIT_MESSAGE);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM grants').first<number>('n')).toBe(0);
  });

  it('refuses a cap of 0 or 1001, a bad username, a bad date and an overlong note without calling GitHub', async () => {
    const { admin, db, deps } = await setup({ octocat: { status: 200, body: { id: 583231, login: 'octocat' } } });
    const cases: Array<Record<string, string>> = [
      { username: 'octocat', cap_gb: '0' },
      { username: 'octocat', cap_gb: '1001' },
      { username: 'octocat', cap_gb: '2.5' },
      { username: '-dash-first' },
      { username: 'way-too-long-for-a-github-username-xxxxxxxxxxxxx' },
      { username: 'octocat', expires: '2026-13-45' },
      { username: 'octocat', expires: '31/12/2026' },
      { username: 'octocat', note: 'n'.repeat(201) },
    ];
    for (const fields of cases) {
      const res = await admin.post('/admin/grants', fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(await res.text()).toContain('class="warn"');
    }
    expect(deps.fetchCalls).toHaveLength(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM grants').first<number>('n')).toBe(0);
    expect(parseAddForm(new URLSearchParams({ username: 'octocat', cap_gb: '1000' }))).toMatchObject({ ok: true, storageCapBytes: 1000 * 1024 ** 3 });
  });

  it('revoke deletes the grant and that account’s tokens answer device_revoked', async () => {
    const { rc, admin, db } = await setup();
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    await addGrant(rc, 200, 'bob', {}, 'admin-add');
    await db.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)').bind('u-alice', 100, 'alice', NOW, 'u-bob', 200, 'bob', NOW).run();
    const alice = await mintDevice(rc, 'u-alice', 'linux-x64', '11111111-2222-4333-8444-555555555555');
    const bob = await mintDevice(rc, 'u-bob', 'linux-x64', '11111111-2222-4333-8444-555555555555');

    const res = await admin.post('/admin/grants/100/revoke');
    expect(res.status).toBe(303);
    expect(await getActiveGrant(rc, 100)).toBeNull();
    expect(await verifyDeviceToken(rc, alice.token)).toEqual({ ok: false, error: 'device_revoked' });
    expect((await verifyDeviceToken(rc, bob.token)).ok).toBe(true);
    expect(await db.prepare('SELECT revoked_by FROM devices WHERE device_id = ?').bind(alice.deviceId).first<string>('revoked_by')).toBe('operator');
    expect((await admin.post('/admin/grants/100/revoke')).status).toBe(303);
    expect((await admin.post('/admin/grants/not-a-number/revoke')).status).toBe(404);
  });

  it('a note containing <script> renders escaped', async () => {
    const { rc, admin } = await setup();
    await addGrant(rc, 100, 'alice', { note: '<script>alert("x")</script>' }, 'admin-add');
    const page = await (await admin.get()).text();
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('without a session GET /admin is the sign-in page and POSTs need the csrf/Origin pair', async () => {
    const { env, deps, admin } = await setup();
    const anon = await (await (await import('./helpers/harness.ts')).call('GET', '/admin', { env, deps })).text();
    expect(anon).toContain('Sign in with GitHub');
    expect(anon).not.toContain('Allowlisted accounts');
    expect((await admin.post('/admin/grants', { username: 'octocat' }, { csrf: 'wrong' })).status).toBe(403);
    expect((await admin.post('/admin/grants/100/revoke', {}, { origin: 'https://evil.example' })).status).toBe(403);
  });
});
