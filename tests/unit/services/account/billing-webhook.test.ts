import { describe, expect, it } from 'vitest';
import { mintDevice } from '../../../../services/account/src/devices.ts';
import { requestDeletion, runDeletionJob } from '../../../../services/account/src/deletion.ts';
import { addGrant, isAllowed, revokeGrant } from '../../../../services/account/src/grants.ts';
import { runMaintenance } from '../../../../services/account/src/maintenance.ts';
import { billingEnv, creemSignature, fakeCreem, postWebhook, TEST_PRODUCT_IDS } from './helpers/billing.ts';
import { call, fakeCtx, makeDeps, makeEnv, makeRc } from './helpers/harness.ts';

const ENV_A = '11111111-2222-4333-8444-555555555555';
const T0 = Date.UTC(2026, 10, 16, 12);
const PERIOD_END = '2027-11-16T12:00:00.000Z';

async function setup(envOverrides = billingEnv()) {
  const env = makeEnv(envOverrides);
  const deps = makeDeps({ now: T0 });
  const rc = makeRc({ env, deps });
  await rc.env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u1', 100, 'alice', T0).run();
  await addGrant(rc, 100, 'alice', {}, 'admin-add');
  await rc.env.DB.prepare("UPDATE grants SET entitlement = 'free' WHERE github_id = ?").bind(100).run();
  return { env, deps, rc };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    status: 'active',
    product: { id: TEST_PRODUCT_IDS.anywhere_annual },
    customer: { id: 'cust_1' },
    current_period_end_date: PERIOD_END,
    ...overrides,
  };
}

function event(id: string, eventType: string, object: Record<string, unknown>, createdAt = T0) {
  return { id, eventType, created_at: createdAt, object };
}

async function rows(env: ReturnType<typeof makeEnv>, table: string) {
  return (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
}

describe('POST /webhooks/creem (PAN-4294 creem-webhook)', () => {
  it('a signed subscription.paid with metadata creates the row and /v1/me then shows anywhere', async () => {
    const { env, deps, rc } = await setup();
    const res = await postWebhook(env, deps, event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await rows(env, 'subscriptions')).toEqual([
      expect.objectContaining({
        subscription_id: 'sub_1',
        user_id: 'u1',
        customer_id: 'cust_1',
        product_key: 'anywhere_annual',
        status: 'active',
        paid_through: Date.parse(PERIOD_END),
        founding: 0,
        last_event_at: T0,
      }),
    ]);
    expect(await rows(env, 'billing_events')).toEqual([{ event_id: 'evt_1', event_type: 'subscription.paid', received_at: T0 }]);

    const device = await mintDevice(rc, 'u1', 'linux-x64', ENV_A);
    const me = await call('GET', '/v1/me', { env, deps, headers: { Authorization: `Bearer ${device.token}` } });
    expect(await me.json()).toMatchObject({ entitlement: { plan: 'anywhere', relay: false, inbox: true, maxDevices: null } });
  });

  it('the same event id twice answers duplicate and changes nothing', async () => {
    const { env, deps } = await setup();
    const payload = event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } }));
    expect((await postWebhook(env, deps, payload)).status).toBe(200);
    const before = await rows(env, 'subscriptions');
    deps.clock.advance(60_000);
    const again = await postWebhook(env, deps, payload);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await rows(env, 'subscriptions')).toEqual(before);
    expect(await rows(env, 'billing_events')).toHaveLength(1);
  });

  it('a bad or missing signature is 401 and writes nothing', async () => {
    const { env, deps } = await setup();
    const payload = event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } }));
    const bad = await postWebhook(env, deps, payload, { signature: creemSignature('something else') });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'invalid_signature' });
    expect((await postWebhook(env, deps, payload, { signature: null })).status).toBe(401);
    expect(await rows(env, 'subscriptions')).toEqual([]);
    expect(await rows(env, 'billing_events')).toEqual([]);
  });

  it('a malformed envelope is 400 invalid_event', async () => {
    const { env, deps } = await setup();
    for (const payload of ['not json', { id: 'x_1', eventType: 'a', created_at: 1, object: {} }, { id: 'evt_1', eventType: 'a', created_at: 'now', object: {} }, { id: 'evt_1', eventType: 'a', created_at: 1, object: [] }]) {
      const res = await postWebhook(env, deps, payload);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_event' });
    }
  });

  it('the route accepts a 20,000-byte signed body and refuses 70,000 bytes with 413; other routes keep 16 KiB', async () => {
    const { env, deps } = await setup();
    const big = event('evt_big', 'refund.created', { id: 'ref_1', note: 'x'.repeat(20_000 - 200) });
    const okBody = JSON.stringify(big);
    expect(okBody.length).toBeGreaterThan(16 * 1024);
    expect(okBody.length).toBeLessThanOrEqual(20_000);
    const ok = await postWebhook(env, deps, okBody);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, ignored: 'event_type' });

    const tooBig = await postWebhook(env, deps, JSON.stringify(event('evt_huge', 'refund.created', { note: 'x'.repeat(70_000) })));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: 'payload_too_large', maxBytes: 65_536 });

    const other = await call('POST', '/oauth/token', { env, deps, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(20_000) });
    expect(other.status).toBe(413);
  });

  it('a subscription.paid without metadata before checkout.completed is 503 and retried once the checkout maps it', async () => {
    const { env, deps } = await setup();
    await env.DB.prepare('INSERT INTO checkouts (checkout_id, user_id, product_key, founding, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)')
      .bind('co_1', 'u1', 'anywhere_annual', T0, T0 + 3_600_000)
      .run();
    const paid = event('evt_paid', 'subscription.paid', subscription());
    const early = await postWebhook(env, deps, paid);
    expect(early.status).toBe(503);
    expect(await early.json()).toEqual({ error: 'unknown_subscription' });
    expect(await rows(env, 'billing_unresolved')).toEqual([
      { event_id: 'evt_paid', event_type: 'subscription.paid', subscription_id: 'sub_1', first_seen_at: T0, last_seen_at: T0, attempts: 1 },
    ]);
    expect(await rows(env, 'billing_events')).toEqual([]);
    deps.clock.advance(30_000);
    expect((await postWebhook(env, deps, paid)).status).toBe(503);
    expect(await rows(env, 'billing_unresolved')).toEqual([expect.objectContaining({ attempts: 2, last_seen_at: T0 + 30_000 })]);

    const completed = await postWebhook(
      env,
      deps,
      event('evt_co', 'checkout.completed', { id: 'ch_creem', request_id: 'co_1', subscription: 'sub_1', product: TEST_PRODUCT_IDS.anywhere_annual }),
    );
    expect(completed.status).toBe(200);
    expect(await rows(env, 'checkouts')).toEqual([
      expect.objectContaining({ checkout_id: 'co_1', creem_checkout_id: 'ch_creem', subscription_id: 'sub_1', completed_at: T0 + 30_000 }),
    ]);
    expect(await rows(env, 'subscriptions')).toEqual([]);

    const retried = await postWebhook(env, deps, paid);
    expect(retried.status).toBe(200);
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ subscription_id: 'sub_1', user_id: 'u1', paid_through: Date.parse(PERIOD_END) })]);
    expect(await rows(env, 'billing_unresolved')).toEqual([]);
  });

  it('checkout.completed with an expanded subscription creates the row, matched by metadata checkout id', async () => {
    const { env, deps } = await setup();
    await env.DB.prepare('INSERT INTO checkouts (checkout_id, user_id, product_key, founding, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?)')
      .bind('co_9', 'u1', 'founding_annual', T0, T0 + 3_600_000)
      .run();
    const res = await postWebhook(
      env,
      deps,
      event('evt_co', 'checkout.completed', {
        id: 'ch_9',
        metadata: { overdeck_checkout_id: 'co_9' },
        customer: { id: 'cust_9' },
        subscription: { id: 'sub_9', status: 'active', product: TEST_PRODUCT_IDS.founding_annual, current_period_end_date: PERIOD_END },
      }),
    );
    expect(res.status).toBe(200);
    expect(await rows(env, 'subscriptions')).toEqual([
      expect.objectContaining({ subscription_id: 'sub_9', user_id: 'u1', customer_id: 'cust_9', product_key: 'founding_annual', founding: 1, paid_through: Date.parse(PERIOD_END) }),
    ]);
  });

  it('a checkout.completed that is not ours is recorded and ignored', async () => {
    const { env, deps } = await setup();
    const res = await postWebhook(env, deps, event('evt_x', 'checkout.completed', { id: 'ch_x', request_id: 'someone-else' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: 'not_ours' });
    expect(await rows(env, 'billing_events')).toHaveLength(1);
  });

  it('subscription.update with a later period end does not move paid_through', async () => {
    const { env, deps } = await setup();
    await postWebhook(env, deps, event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } })));
    const res = await postWebhook(env, deps, event('evt_2', 'subscription.update', subscription({ current_period_end_date: '2028-01-01T00:00:00Z' }), T0 + 1_000));
    expect(res.status).toBe(200);
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ paid_through: Date.parse(PERIOD_END), last_event_at: T0 + 1_000 })]);
  });

  it('paid_through only moves forward', async () => {
    const { env, deps } = await setup();
    await postWebhook(env, deps, event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } })));
    await postWebhook(env, deps, event('evt_2', 'subscription.paid', subscription({ current_period_end_date: '2027-01-01T00:00:00Z' }), T0 + 1_000));
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ paid_through: Date.parse(PERIOD_END) })]);
  });

  it('an older subscription.canceled after a newer subscription.paid leaves the row active', async () => {
    const { env, deps } = await setup();
    await postWebhook(env, deps, event('evt_new', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } }), T0 + 5_000));
    const res = await postWebhook(env, deps, event('evt_old', 'subscription.canceled', subscription({ status: 'canceled' }), T0));
    expect(res.status).toBe(200);
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ status: 'active', last_event_at: T0 + 5_000 })]);
    expect(await rows(env, 'billing_events')).toHaveLength(2);
  });

  it('an older subscription.paid after a newer subscription.active still sets paid_through and keeps the newer status', async () => {
    const { env, deps } = await setup();
    await postWebhook(env, deps, event('evt_active', 'subscription.active', subscription({ status: 'trialing', metadata: { overdeck_user_id: 'u1' } }), T0 + 5));
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ paid_through: null, status: 'trialing' })]);
    const res = await postWebhook(env, deps, event('evt_paid', 'subscription.paid', subscription({ status: 'active' }), T0));
    expect(res.status).toBe(200);
    expect(await rows(env, 'subscriptions')).toEqual([
      expect.objectContaining({ paid_through: Date.parse(PERIOD_END), status: 'trialing', last_event_at: T0 + 5 }),
    ]);
  });

  it('a later subscription.canceled updates the status from the existing row', async () => {
    const { env, deps } = await setup();
    await postWebhook(env, deps, event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } })));
    await postWebhook(env, deps, event('evt_2', 'subscription.canceled', subscription({ status: 'canceled' }), T0 + 1_000));
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ status: 'canceled', user_id: 'u1' })]);
  });

  it('an unknown product is recorded with no row', async () => {
    const { env, deps } = await setup();
    const res = await postWebhook(env, deps, event('evt_1', 'subscription.paid', subscription({ product: { id: 'prod_other' }, metadata: { overdeck_user_id: 'u1' } })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: 'unknown_product' });
    expect(await rows(env, 'subscriptions')).toEqual([]);
    expect(await rows(env, 'billing_events')).toHaveLength(1);
  });

  it('billing unconfigured answers 503 billing_not_configured', async () => {
    const { env, deps } = await setup({});
    const res = await postWebhook(env, deps, event('evt_1', 'subscription.paid', subscription({ metadata: { overdeck_user_id: 'u1' } })));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'billing_not_configured' });
  });
});

describe('late payments for a deleted or revoked account (PAN-4294 FR-11)', () => {
  async function lateSetup() {
    const creem = fakeCreem({
      'POST /v1/subscriptions/sub_late/cancel': () => ({ status: 200, body: { id: 'sub_late', status: 'canceled' } }),
    });
    const env = makeEnv(billingEnv());
    const deps = makeDeps({ now: T0, fetch: creem.fetch });
    const rc = makeRc({ env, deps });
    await env.DB.prepare('INSERT INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)').bind('u1', 100, 'alice', T0).run();
    await addGrant(rc, 100, 'alice', {}, 'admin-add');
    await env.DB.prepare('INSERT INTO checkouts (checkout_id, user_id, product_key, founding, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)')
      .bind('co_1', 'u1', 'anywhere_annual', T0, T0 + 3_600_000)
      .run();
    return { env, deps, rc, creem };
  }

  const latePaid = (id = 'evt_late') =>
    event(id, 'subscription.paid', subscription({ id: 'sub_late', metadata: { overdeck_user_id: 'u1', overdeck_checkout_id: 'co_1' } }));
  const cancels = (creem: ReturnType<typeof fakeCreem>) => creem.requests.filter((r) => r.path === '/v1/subscriptions/sub_late/cancel');

  it('a payment that lands after the deletion completed is cancelled in Creem, and the row is purged afterwards', async () => {
    const { env, deps, rc, creem } = await lateSetup();
    await requestDeletion(rc, 'u1');
    expect(await runDeletionJob(rc, 'u1')).toMatchObject({ holders_pending: '[]' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);

    const ctx = fakeCtx();
    const res = await postWebhook(env, deps, latePaid(), { ctx });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cancelled: 'gone' });
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ subscription_id: 'sub_late', user_id: 'u1', revoked_at: T0, cancel_requested_at: T0 })]);
    await ctx.drain();
    expect(cancels(creem)).toEqual([expect.objectContaining({ body: { mode: 'immediate' } })]);
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ cancel_done_at: T0 })]);

    expect((await runMaintenance(env, deps)).purged.subscriptions).toBe(1);
    expect(await rows(env, 'subscriptions')).toEqual([]);
  });

  it('a failed cancel stays queued and the hourly cron retries it', async () => {
    let status = 500;
    const creem = fakeCreem({ 'POST /v1/subscriptions/sub_late/cancel': () => ({ status, body: {} }) });
    const { env, rc } = await lateSetup();
    const deps = makeDeps({ now: T0, fetch: creem.fetch });
    await requestDeletion(makeRc({ env, deps }), 'u1');
    await runDeletionJob(rc, 'u1');
    const ctx = fakeCtx();
    await postWebhook(env, deps, latePaid(), { ctx });
    await ctx.drain();
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ cancel_done_at: null, cancel_attempts: 1 })]);
    status = 404;
    deps.clock.advance(3_600_000);
    await runMaintenance(env, deps);
    expect(cancels(creem)).toHaveLength(2);
    expect(await rows(env, 'subscriptions')).toEqual([]);
  });

  it('a checkout.completed naming the subscription only by id is cancelled too after deletion', async () => {
    const { env, deps, rc, creem } = await lateSetup();
    await requestDeletion(rc, 'u1');
    await runDeletionJob(rc, 'u1');
    const ctx = fakeCtx();
    const res = await postWebhook(
      env,
      deps,
      event('evt_co', 'checkout.completed', { id: 'ch_1', request_id: 'co_1', subscription: 'sub_late', product: TEST_PRODUCT_IDS.anywhere_annual, metadata: { overdeck_user_id: 'u1' } }),
      { ctx },
    );
    expect(await res.json()).toEqual({ ok: true, cancelled: 'gone' });
    await ctx.drain();
    expect(cancels(creem)).toHaveLength(1);
  });

  it('a payment that lands after an operator revoke stays revoked, is cancelled and does not re-admit the account', async () => {
    const { env, deps, rc, creem } = await lateSetup();
    await revokeGrant(rc, 100);
    expect(await isAllowed(rc, 100)).toBe(false);

    const ctx = fakeCtx();
    const res = await postWebhook(env, deps, latePaid(), { ctx });
    expect(await res.json()).toEqual({ ok: true, cancelled: 'revoked' });
    expect(await isAllowed(rc, 100)).toBe(false);
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ revoked_at: T0, cancel_requested_at: T0 })]);
    await ctx.drain();
    expect(cancels(creem)).toHaveLength(1);

    // A later event for the same subscription keeps it revoked and asks for no second cancel.
    await postWebhook(env, deps, event('evt_later', 'subscription.canceled', subscription({ id: 'sub_late', status: 'canceled' }), T0 + 1_000), { ctx: fakeCtx() });
    expect(await isAllowed(rc, 100)).toBe(false);
    expect(cancels(creem)).toHaveLength(1);
  });

  it('an allowlisted account paying normally is not refused', async () => {
    const { env, deps, creem } = await lateSetup();
    const res = await postWebhook(env, deps, latePaid());
    expect(await res.json()).toEqual({ ok: true });
    expect(await rows(env, 'subscriptions')).toEqual([expect.objectContaining({ revoked_at: null, cancel_requested_at: null })]);
    expect(creem.requests).toEqual([]);
  });
});
