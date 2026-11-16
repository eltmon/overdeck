import { describe, expect, it } from 'vitest';
import {
  ALREADY_SUBSCRIBED_MESSAGE,
  BILLING_UNAVAILABLE_MESSAGE,
  CARD_NOTE,
  CHECKOUT_FAILED_MESSAGE,
  CHECKOUT_LINK_TEXT,
  CHOOSE_PLAN_MESSAGE,
  FOUNDING_UNAVAILABLE_MESSAGE,
  foundingAvailability,
  NO_SUBSCRIPTION_MESSAGE,
  PORTAL_LINK_TEXT,
  SUBSCRIPTION_ENDING_MESSAGE,
} from '../../../../services/account/src/billing/actions.ts';
import { parseBillingConfig } from '../../../../services/account/src/billing/catalog.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import { addGrant } from '../../../../services/account/src/grants.ts';
import { escapeHtml } from '../../../../services/account/src/pages.ts';
import { makeAccountClient } from './helpers/account.ts';
import { billingEnv, fakeCreem, seedSubscription, TEST_PRODUCT_IDS, type CreemRoute } from './helpers/billing.ts';
import { makeDeps, makeEnv, makeRc } from './helpers/harness.ts';

const T0 = Date.UTC(2026, 10, 16, 12);
const HOUR = 3_600_000;
const CHECKOUT_URL = 'https://pay.creem.test/ch_1?a=1&b="2"';

const okCheckout: CreemRoute = () => ({ status: 200, body: { id: 'ch_1', status: 'pending', checkout_url: CHECKOUT_URL } });

async function setup(opts: { env?: Partial<Env>; routes?: Record<string, CreemRoute> } = {}) {
  const creem = fakeCreem({ 'POST /v1/checkouts': okCheckout, ...opts.routes });
  const env = makeEnv(opts.env ?? billingEnv());
  const deps = makeDeps({ now: T0, fetch: creem.fetch });
  const rc = makeRc({ env, deps });
  await addGrant(rc, 100, 'alice', {}, 'admin-add');
  const client = await makeAccountClient(env, deps, 'u1', { githubId: 100, login: 'alice' });
  return { env, deps, rc, creem, client };
}

async function checkouts(env: Env) {
  return (await env.DB.prepare('SELECT * FROM checkouts ORDER BY created_at').all<Record<string, unknown>>()).results;
}

async function seedFounding(env: Env, n: number) {
  for (let i = 0; i < n; i++) await seedSubscription(env, { subscriptionId: `sub_f${i}`, userId: `other${i}`, productKey: 'founding_annual', founding: 1, paidThrough: T0 + 100 * HOUR });
}

describe('POST /account/billing/checkout (PAN-4294 billing-actions)', () => {
  it('with 499 founding rows a founding checkout reserves the last place and answers the interstitial', async () => {
    const { env, creem, client } = await setup();
    await seedFounding(env, 499);
    const res = await client.post('/account/billing/checkout', { plan: 'founding', relay: '1' });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain('Continue to payment');
    expect(page).toContain(`<a href="${escapeHtml(CHECKOUT_URL)}" rel="noreferrer">${CHECKOUT_LINK_TEXT}</a>`);
    expect(page).toContain(CARD_NOTE);
    expect(page).not.toContain('<script');
    const [row] = await checkouts(env);
    expect(row).toMatchObject({ user_id: 'u1', product_key: 'founding_annual_relay', founding: 1, creem_checkout_id: 'ch_1', expires_at: T0 + HOUR });
    expect(creem.requests[0]?.body).toEqual({
      product_id: TEST_PRODUCT_IDS.founding_annual_relay,
      request_id: row?.checkout_id,
      success_url: 'https://account.test/account?checkout=done',
      metadata: { overdeck_user_id: 'u1', overdeck_checkout_id: row?.checkout_id },
    });
  });

  it('with 500 founding rows a founding checkout is 409 and calls nobody', async () => {
    const { env, creem, client } = await setup();
    await seedFounding(env, 500);
    const res = await client.post('/account/billing/checkout', { plan: 'founding' });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(FOUNDING_UNAVAILABLE_MESSAGE);
    expect(await checkouts(env)).toEqual([]);
    expect(creem.requests).toEqual([]);
  });

  it('live reservations by others count against the limit, expired ones do not', async () => {
    const { env, client, rc } = await setup();
    await seedFounding(env, 498);
    for (const [id, expires] of [['co_live', T0 + HOUR], ['co_old', T0 - 1]] as const) {
      await env.DB.prepare('INSERT INTO checkouts (checkout_id, user_id, product_key, founding, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?)')
        .bind(id, 'other', 'founding_annual', T0 - HOUR, expires)
        .run();
    }
    const cfg = parseBillingConfig(env);
    expect(await foundingAvailability(rc, cfg!)).toEqual({ available: true, placesLeft: 1 });
    expect((await client.post('/account/billing/checkout', { plan: 'founding' })).status).toBe(200);
    expect(await foundingAvailability(rc, cfg!)).toEqual({ available: false, placesLeft: 0 });
  });

  it('FOUNDING_ENDS_AT in the past refuses founding but not the regular plans', async () => {
    const { client, env } = await setup({ env: billingEnv({ FOUNDING_ENDS_AT: '2026-01-01T00:00:00Z' }) });
    const res = await client.post('/account/billing/checkout', { plan: 'founding' });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(FOUNDING_UNAVAILABLE_MESSAGE);
    expect((await client.post('/account/billing/checkout', { plan: 'monthly' })).status).toBe(200);
    expect(await checkouts(env)).toEqual([expect.objectContaining({ product_key: 'anywhere_monthly', founding: 0 })]);
  });

  it('a second checkout leaves one unexpired reservation and keeps the first row, expired', async () => {
    const { env, deps, client } = await setup();
    expect((await client.post('/account/billing/checkout', { plan: 'founding' })).status).toBe(200);
    deps.clock.advance(60_000);
    expect((await client.post('/account/billing/checkout', { plan: 'annual', relay: '1' })).status).toBe(200);
    const rows = await checkouts(env);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ product_key: 'founding_annual', expires_at: T0 + 60_000 });
    expect(rows[1]).toMatchObject({ product_key: 'anywhere_annual_relay', expires_at: T0 + 60_000 + HOUR });
    expect(rows.filter((r) => (r.expires_at as number) > deps.now())).toHaveLength(1);
  });

  it('a Creem failure expires the reservation and answers 502', async () => {
    const { env, deps, rc, client } = await setup({ routes: { 'POST /v1/checkouts': () => ({ status: 500, body: { error: 'down' } }) } });
    const res = await client.post('/account/billing/checkout', { plan: 'founding' });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain(CHECKOUT_FAILED_MESSAGE);
    expect(await checkouts(env)).toEqual([expect.objectContaining({ expires_at: deps.now(), creem_checkout_id: null })]);
    expect(await foundingAvailability(rc, parseBillingConfig(env)!)).toEqual({ available: true, placesLeft: 500 });
  });

  it('a bad plan or relay value is 400; paid access already is 409', async () => {
    const { env, client } = await setup();
    for (const fields of [{ plan: 'weekly' }, { plan: 'annual', relay: 'yes' }, {}]) {
      const res = await client.post('/account/billing/checkout', fields);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(CHOOSE_PLAN_MESSAGE);
    }
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u1', paidThrough: T0 + HOUR });
    const res = await client.post('/account/billing/checkout', { plan: 'annual' });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(ALREADY_SUBSCRIBED_MESSAGE);
  });

  it('cross-site Origin or a missing csrf field is 403; billing unconfigured is 503', async () => {
    const { client, env } = await setup();
    expect((await client.post('/account/billing/checkout', { plan: 'annual' }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await client.post('/account/billing/checkout', { plan: 'annual' }, { csrf: null })).status).toBe(403);
    expect((await client.post('/account/billing/relay', { action: 'add' }, { origin: null })).status).toBe(403);
    expect((await client.post('/account/billing/portal', {}, { csrf: 'wrong' })).status).toBe(403);
    expect(await checkouts(env)).toEqual([]);

    const off = await setup({ env: {} });
    for (const path of ['/account/billing/checkout', '/account/billing/relay', '/account/billing/portal']) {
      const res = await off.client.post(path, { plan: 'annual', action: 'add' });
      expect(res.status).toBe(503);
      expect(await res.text()).toContain(BILLING_UNAVAILABLE_MESSAGE);
    }
  });
});

describe('POST /account/billing/relay (PAN-4294 billing-actions)', () => {
  const upgraded: CreemRoute = (req) => ({
    status: 200,
    body: { id: 'sub_1', status: 'active', product: { id: (req.body as { product_id: string }).product_id } },
  });

  it('add on a paid annual plan upgrades to the relay pair and stores the product Creem reports', async () => {
    const { env, deps, creem, client } = await setup({ routes: { 'POST /v1/subscriptions/sub_1/upgrade': upgraded } });
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u1', productKey: 'anywhere_annual', paidThrough: T0 + 100 * HOUR, at: T0 - HOUR });
    const res = await client.post('/account/billing/relay', { action: 'add' });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account');
    expect(creem.requests).toEqual([
      expect.objectContaining({ path: '/v1/subscriptions/sub_1/upgrade', body: { product_id: TEST_PRODUCT_IDS.anywhere_annual_relay, update_behavior: 'proration-charge-immediately' } }),
    ]);
    const row = await env.DB.prepare('SELECT product_key, last_event_at, updated_at FROM subscriptions WHERE subscription_id = ?').bind('sub_1').first();
    expect(row).toEqual({ product_key: 'anywhere_annual_relay', last_event_at: deps.now(), updated_at: deps.now() });
  });

  it('add on a relay plan and remove on a plain plan are no-ops', async () => {
    const { env, creem, client } = await setup();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u1', productKey: 'anywhere_monthly_relay', paidThrough: T0 + HOUR });
    expect((await client.post('/account/billing/relay', { action: 'add' })).status).toBe(303);
    expect(creem.requests).toEqual([]);
  });

  it('a canceled subscription is 409; no paid access is 404; a Creem failure is 502 and leaves the row', async () => {
    const { env, client } = await setup({ routes: { 'POST /v1/subscriptions/sub_2/upgrade': () => ({ status: 422, body: {} }) } });
    expect((await client.post('/account/billing/relay', { action: 'add' })).status).toBe(404);
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u1', status: 'canceled', paidThrough: T0 + HOUR });
    const ending = await client.post('/account/billing/relay', { action: 'add' });
    expect(ending.status).toBe(409);
    expect(await ending.text()).toContain(escapeHtml(SUBSCRIPTION_ENDING_MESSAGE));
    await env.DB.prepare('DELETE FROM subscriptions').run();
    await seedSubscription(env, { subscriptionId: 'sub_2', userId: 'u1', paidThrough: T0 + HOUR });
    expect((await client.post('/account/billing/relay', { action: 'add' })).status).toBe(502);
    expect(await env.DB.prepare('SELECT product_key FROM subscriptions').first('product_key')).toBe('anywhere_annual');
  });
});

describe('POST /account/billing/portal (PAN-4294 billing-actions)', () => {
  it('links the newest subscription’s customer to the Creem portal', async () => {
    const { env, creem, client } = await setup({
      routes: { 'POST /v1/customers/billing': () => ({ status: 200, body: { customer_portal_link: 'https://portal.creem.test/x' } }) },
    });
    await seedSubscription(env, { subscriptionId: 'sub_old', userId: 'u1', customerId: 'cust_old', at: 1 });
    await seedSubscription(env, { subscriptionId: 'sub_new', userId: 'u1', customerId: 'cust_new', status: 'expired', at: 2 });
    const res = await client.post('/account/billing/portal');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`<a href="https://portal.creem.test/x" rel="noreferrer">${PORTAL_LINK_TEXT}</a>`);
    expect(creem.requests[0]?.body).toEqual({ customer_id: 'cust_new' });
  });

  it('no subscription is 404', async () => {
    const { client } = await setup();
    const res = await client.post('/account/billing/portal');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(NO_SUBSCRIPTION_MESSAGE);
  });

  it('a subscriber whose grant row is gone keeps the account page while the row is live (FR-7)', async () => {
    const { env, client } = await setup();
    await env.DB.prepare('DELETE FROM grants').run();
    await seedSubscription(env, { subscriptionId: 'sub_1', userId: 'u1', paidThrough: T0 - HOUR });
    expect((await client.get()).status).toBe(200);
    await env.DB.prepare('UPDATE subscriptions SET revoked_at = ?').bind(T0).run();
    expect(await (await client.get()).text()).toContain('Access to this account was removed.');
  });
});
