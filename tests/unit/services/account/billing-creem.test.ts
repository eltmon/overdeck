import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseBillingConfig } from '../../../../services/account/src/billing/catalog.ts';
import {
  CREEM_PORTAL_PATH,
  cancelSubscription,
  createCheckout,
  idOf,
  portalLink,
  upgradeSubscription,
  verifySignature,
} from '../../../../services/account/src/billing/creem.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import { billingEnv, fakeCreem, TEST_WEBHOOK_SECRET, type CreemRoute } from './helpers/billing.ts';
import { makeDeps } from './helpers/harness.ts';

const cfg = (() => {
  const parsed = parseBillingConfig({ DB: {} as D1Database, ...billingEnv() } as Env);
  if (parsed === null) throw new Error('test billing config did not parse');
  return parsed;
})();

function client(routes: Record<string, CreemRoute>) {
  const creem = fakeCreem(routes);
  return { creem, deps: makeDeps({ fetch: creem.fetch }) };
}

const JSON_HEADERS = { 'x-api-key': 'creem_test_key', 'content-type': 'application/json' };

describe('Creem client (PAN-4294 creem-client)', () => {
  it('createCheckout posts the product, request id, success URL and metadata', async () => {
    const { creem, deps } = client({ 'POST /v1/checkouts': () => ({ status: 200, body: { id: 'ch_1', status: 'pending', checkout_url: 'https://pay.creem.test/ch_1' } }) });
    const result = await createCheckout(cfg, deps, {
      productId: 'prod_annual',
      requestId: 'co_1',
      successUrl: 'https://account.test/account?checkout=done',
      metadata: { overdeck_user_id: 'u1', overdeck_checkout_id: 'co_1' },
    });
    expect(result).toEqual({ ok: true, checkoutId: 'ch_1', checkoutUrl: 'https://pay.creem.test/ch_1' });
    expect(creem.requests).toHaveLength(1);
    expect(creem.requests[0]).toMatchObject({ method: 'POST', path: '/v1/checkouts', headers: JSON_HEADERS });
    expect(creem.requests[0]?.body).toEqual({
      product_id: 'prod_annual',
      request_id: 'co_1',
      success_url: 'https://account.test/account?checkout=done',
      metadata: { overdeck_user_id: 'u1', overdeck_checkout_id: 'co_1' },
    });
    expect(deps.fetchCalls[0]?.url).toBe('https://creem.test/v1/checkouts');
  });

  it('createCheckout refuses an http checkout_url or a missing id', async () => {
    const http = client({ 'POST /v1/checkouts': () => ({ status: 200, body: { id: 'ch_1', checkout_url: 'http://pay.creem.test/ch_1' } }) });
    expect(await createCheckout(cfg, http.deps, { productId: 'p', requestId: 'r', successUrl: 's', metadata: {} })).toMatchObject({ ok: false, status: 502 });
    const noId = client({ 'POST /v1/checkouts': () => ({ status: 200, body: { checkout_url: 'https://pay.creem.test/x' } }) });
    expect(await createCheckout(cfg, noId.deps, { productId: 'p', requestId: 'r', successUrl: 's', metadata: {} })).toMatchObject({ ok: false, status: 502 });
  });

  it('upgradeSubscription posts the new product with immediate proration', async () => {
    const { creem, deps } = client({
      'POST /v1/subscriptions/sub_1/upgrade': () => ({ status: 200, body: { id: 'sub_1', product: { id: 'prod_annual_relay' }, status: 'active' } }),
    });
    expect(await upgradeSubscription(cfg, deps, 'sub_1', 'prod_annual_relay')).toEqual({
      ok: true,
      subscription: { id: 'sub_1', product: { id: 'prod_annual_relay' }, status: 'active' },
    });
    expect(creem.requests[0]).toMatchObject({ method: 'POST', path: '/v1/subscriptions/sub_1/upgrade', headers: JSON_HEADERS });
    expect(creem.requests[0]?.body).toEqual({ product_id: 'prod_annual_relay', update_behavior: 'proration-charge-immediately' });
  });

  it('cancelSubscription posts mode immediate and maps 200, 404 and errors', async () => {
    const ok = client({ 'POST /v1/subscriptions/sub_1/cancel': () => ({ status: 200, body: { id: 'sub_1', status: 'canceled' } }) });
    expect(await cancelSubscription(cfg, ok.deps, 'sub_1')).toBe('cancelled');
    expect(ok.creem.requests[0]).toMatchObject({ method: 'POST', path: '/v1/subscriptions/sub_1/cancel', headers: JSON_HEADERS, body: { mode: 'immediate' } });
    const gone = client({ 'POST /v1/subscriptions/sub_1/cancel': () => ({ status: 404, body: { error: 'not found' } }) });
    expect(await cancelSubscription(cfg, gone.deps, 'sub_1')).toBe('not_found');
    const broken = client({ 'POST /v1/subscriptions/sub_1/cancel': () => ({ status: 500, body: { error: 'boom' } }) });
    expect(await cancelSubscription(cfg, broken.deps, 'sub_1')).toEqual({ error: '500 {"error":"boom"}' });
  });

  it('portalLink posts the customer id to the portal path and returns only an https link', async () => {
    expect(CREEM_PORTAL_PATH).toBe('/v1/customers/billing');
    const ok = client({ 'POST /v1/customers/billing': () => ({ status: 200, body: { customer_portal_link: 'https://portal.creem.test/c1' } }) });
    expect(await portalLink(cfg, ok.deps, 'cust_1')).toEqual({ ok: true, url: 'https://portal.creem.test/c1' });
    expect(ok.creem.requests[0]).toMatchObject({ method: 'POST', path: '/v1/customers/billing', headers: JSON_HEADERS, body: { customer_id: 'cust_1' } });
    const http = client({ 'POST /v1/customers/billing': () => ({ status: 200, body: { customer_portal_link: 'javascript:alert(1)' } }) });
    expect(await portalLink(cfg, http.deps, 'cust_1')).toMatchObject({ ok: false, status: 502 });
  });

  it('a non-2xx answer, a thrown fetch or a non-JSON body is a failure, never a throw', async () => {
    const denied = client({ 'POST /v1/checkouts': () => ({ status: 403, body: { error: 'forbidden' } }) });
    expect(await createCheckout(cfg, denied.deps, { productId: 'p', requestId: 'r', successUrl: 's', metadata: {} })).toEqual({
      ok: false,
      status: 403,
      detail: '{"error":"forbidden"}',
    });
    const thrown = makeDeps({
      fetch: async () => {
        throw new Error('network down');
      },
    });
    expect(await createCheckout(cfg, thrown, { productId: 'p', requestId: 'r', successUrl: 's', metadata: {} })).toEqual({ ok: false, status: 502, detail: 'network down' });
    expect(await upgradeSubscription(cfg, thrown, 'sub_1', 'p')).toMatchObject({ ok: false, status: 502 });
    expect(await cancelSubscription(cfg, thrown, 'sub_1')).toEqual({ error: '502 network down' });
    expect(await portalLink(cfg, thrown, 'c')).toMatchObject({ ok: false, status: 502 });
    const notJson = makeDeps({ fetch: async () => new Response('<html>', { status: 200 }) });
    expect(await upgradeSubscription(cfg, notJson, 'sub_1', 'p')).toMatchObject({ ok: false, status: 502 });
  });

  it('idOf reads an id string or an expanded object', () => {
    expect(idOf('sub_1')).toBe('sub_1');
    expect(idOf({ id: 'prod_1', name: 'x' })).toBe('prod_1');
    expect(idOf(null)).toBeNull();
    expect(idOf('')).toBeNull();
    expect(idOf({ name: 'x' })).toBeNull();
  });
});

describe('webhook signature (PAN-4294 NFR-2)', () => {
  const body = new TextEncoder().encode('{"id":"evt_1","eventType":"subscription.paid"}');
  const good = createHmac('sha256', TEST_WEBHOOK_SECRET).update(body).digest('hex');

  it('accepts the exact HMAC-SHA256 hex of the raw body', async () => {
    expect(await verifySignature(TEST_WEBHOOK_SECRET, body, good)).toBe(true);
  });

  it('rejects a one-character change, a different length, another secret and a missing header', async () => {
    const flipped = (good[0] === 'a' ? 'b' : 'a') + good.slice(1);
    expect(await verifySignature(TEST_WEBHOOK_SECRET, body, flipped)).toBe(false);
    expect(await verifySignature(TEST_WEBHOOK_SECRET, body, good.slice(0, -1))).toBe(false);
    expect(await verifySignature(TEST_WEBHOOK_SECRET, body, `${good}0`)).toBe(false);
    expect(await verifySignature('other-secret', body, good)).toBe(false);
    expect(await verifySignature(TEST_WEBHOOK_SECRET, body, null)).toBe(false);
    expect(await verifySignature(TEST_WEBHOOK_SECRET, body, '')).toBe(false);
  });
});
