import { describe, expect, it } from 'vitest';
import { formatCap, GITHUB_RATE_LIMIT_MESSAGE, parseAddForm, USER_NOT_FOUND_MESSAGE } from '../../../../services/account/src/admin/screen.ts';
import { mintDevice, verifyDeviceToken } from '../../../../services/account/src/devices.ts';
import { addGrant, getActiveGrant, getPendingAttempt, recordPendingAttempt } from '../../../../services/account/src/grants.ts';
import { makeAdminClient } from './helpers/admin.ts';
import { githubMock, type GitHubMockOptions } from './helpers/github-mock.ts';
import { billingEnv, fakeCreem, seedSubscription } from './helpers/billing.ts';
import { dbOf, fakeCtx, makeDeps, makeEnv, makeRc } from './helpers/harness.ts';

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

  it('revoke marks the account’s subscriptions revoked and sends the cancel (PAN-4294 D-11)', async () => {
    const creem = fakeCreem({ 'POST /v1/subscriptions/sub_1/cancel': () => ({ status: 200, body: { id: 'sub_1', status: 'canceled' } }) });
    const env = makeEnv(billingEnv());
    const deps = makeDeps({ now: NOW, fetch: creem.fetch });
    const rc = makeRc({ env, deps });
    const admin = await makeAdminClient(env, deps);
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    await env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u-alice', 100, 'alice', NOW).run();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-alice', paidThrough: NOW + DAY });
    const ctx = fakeCtx();
    expect((await admin.post('/admin/grants/100/revoke', {}, { ctx })).status).toBe(303);
    expect(await env.DB.prepare('SELECT revoked_at, cancel_requested_at FROM subscriptions').first()).toEqual({ revoked_at: NOW, cancel_requested_at: NOW });
    await ctx.drain();
    expect(creem.requests).toEqual([expect.objectContaining({ path: '/v1/subscriptions/sub_1/cancel', body: { mode: 'immediate' } })]);
    expect(await env.DB.prepare('SELECT cancel_done_at FROM subscriptions').first('cancel_done_at')).toBe(NOW);
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

describe('admin screen billing view (PAN-4294 admin-billing-view)', () => {
  async function billingSetup(withBilling = true) {
    const env = makeEnv(withBilling ? billingEnv() : {});
    const deps = makeDeps({ now: NOW });
    const rc = makeRc({ env, deps });
    const admin = await makeAdminClient(env, deps);
    const user = (id: string, githubId: number, login: string) =>
      env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind(id, githubId, login, NOW).run();
    return { env, rc, admin, user };
  }

  it('shows each grant’s billing state in a Billing column', async () => {
    const { env, rc, admin, user } = await billingSetup();
    for (const [id, gh, login] of [['u-paid', 100, 'paid'], ['u-due', 200, 'due'], ['u-lapsed', 300, 'lapsed'], ['u-none', 400, 'none']] as const) {
      await addGrant(rc, gh, login, {}, 'admin-add');
      await user(id, gh, login);
    }
    await seedSubscription(env, { subscriptionId: 'sub_paid', userId: 'u-paid', productKey: 'anywhere_annual_relay', paidThrough: Date.UTC(2027, 0, 2) });
    await seedSubscription(env, { subscriptionId: 'sub_due', userId: 'u-due', status: 'past_due', paidThrough: NOW - DAY });
    await seedSubscription(env, { subscriptionId: 'sub_lapsed', userId: 'u-lapsed', status: 'expired', paidThrough: Date.UTC(2026, 8, 1) });
    const page = await (await admin.get()).text();
    expect(page).toContain('<th>Billing</th>');
    expect(page).toContain('<td>Anywhere annual with the relay, paid through 2027-01-02</td>');
    expect(page).toContain('<td>Past due</td>');
    expect(page).toContain('<td>Lapsed on 2026-09-01</td>');
    expect(page.match(/<td>—<\/td>/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it('shows founding places sold, failing cancels, unmatched events and subscribers without an invite', async () => {
    const { env, admin, user } = await billingSetup();
    for (let i = 0; i < 3; i++) {
      await user(`u-f${i}`, 500 + i, `founder${i}`);
      await seedSubscription(env, { subscriptionId: `sub_f${i}`, userId: `u-f${i}`, productKey: 'founding_annual', founding: 1, paidThrough: NOW + DAY });
    }
    await env.DB.prepare("UPDATE subscriptions SET cancel_requested_at = ?, cancel_attempts = 2, cancel_error = '500 <boom>' WHERE subscription_id = 'sub_f0'").bind(NOW).run();
    await env.DB.prepare('INSERT INTO billing_unresolved (event_id, event_type, subscription_id, first_seen_at, last_seen_at, attempts) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('evt_lost', 'subscription.paid', 'sub_lost', NOW, NOW, 3)
      .run();
    const page = await (await admin.get()).text();
    expect(page).toContain('Founding places sold: 3 of 500');
    expect(page).toContain('<h2>Subscription cancels failing</h2>');
    expect(page).toContain('Cancel these by hand in the Creem dashboard.');
    expect(page).toContain('<tr><td>founder0</td><td>sub_f0</td><td>2</td><td>500 &lt;boom&gt;</td></tr>');
    expect(page).toContain('<h2>Webhook events not matched to an account</h2>');
    expect(page).toContain('Creem retries these for 24 hours. Match them by hand if they stay.');
    expect(page).toContain('<tr><td>evt_lost</td><td>subscription.paid</td><td>sub_lost</td><td>2026-10-01 12:00 UTC</td><td>3</td></tr>');
    expect(page).toContain('<h2>Subscribers without an invite</h2>');
    expect(page).toContain(`<tr><td>founder1</td><td>501</td><td>Founding annual, paid through ${new Date(NOW + DAY).toISOString().slice(0, 10)}</td></tr>`);
  });

  it('hides the whole billing view when billing is not configured', async () => {
    const { env, rc, admin, user } = await billingSetup(false);
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    await user('u-alice', 100, 'alice');
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u-alice', founding: 1, paidThrough: NOW + DAY });
    await env.DB.prepare("UPDATE subscriptions SET cancel_error = 'x'").run();
    const page = await (await admin.get()).text();
    for (const text of ['Founding places sold', '<th>Billing</th>', 'Subscription cancels failing', 'Webhook events not matched', 'Subscribers without an invite']) {
      expect(page).not.toContain(text);
    }
  });
});
