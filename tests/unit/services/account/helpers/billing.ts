/**
 * Billing fixtures for the account-service unit tests (PAN-4294).
 */
import { createHmac } from 'node:crypto';
import type { Deps, Env } from '../../../../../services/account/src/env.ts';
import { call, type FakeCtx } from './harness.ts';

export interface SubscriptionSeed {
  subscriptionId: string;
  userId: string;
  productKey?: string;
  status?: string;
  paidThrough?: number | null;
  founding?: 0 | 1;
  revokedAt?: number | null;
  customerId?: string;
  at?: number;
}

/** Insert one `subscriptions` row with sensible defaults (an active annual plan, not revoked). */
export async function seedSubscription(env: Env, seed: SubscriptionSeed): Promise<void> {
  const at = seed.at ?? 1;
  await env.DB.prepare(
    `INSERT INTO subscriptions (subscription_id, user_id, customer_id, product_key, status, paid_through, founding, created_at, updated_at, last_event_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      seed.subscriptionId,
      seed.userId,
      seed.customerId ?? `cust_${seed.userId}`,
      seed.productKey ?? 'anywhere_annual',
      seed.status ?? 'active',
      seed.paidThrough === undefined ? null : seed.paidThrough,
      seed.founding ?? 0,
      at,
      at,
      at,
      seed.revokedAt ?? null,
    )
    .run();
}

export const TEST_CREEM_API_BASE = 'https://creem.test';
export const TEST_WEBHOOK_SECRET = 'whsec_test_secret';
export const TEST_PRODUCT_IDS = {
  anywhere_monthly: 'prod_monthly',
  anywhere_monthly_relay: 'prod_monthly_relay',
  anywhere_annual: 'prod_annual',
  anywhere_annual_relay: 'prod_annual_relay',
  founding_annual: 'prod_founding',
  founding_annual_relay: 'prod_founding_relay',
} as const;

/** The Env keys that switch billing on; spread into makeEnv(). */
export function billingEnv(overrides: Partial<Env> = {}): Partial<Env> {
  return {
    CREEM_API_KEY: 'creem_test_key',
    CREEM_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    CREEM_API_BASE: TEST_CREEM_API_BASE,
    CREEM_PRODUCTS: JSON.stringify(TEST_PRODUCT_IDS),
    ...overrides,
  };
}

export interface CreemRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type CreemRoute = (req: CreemRequest) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/**
 * A fake Creem API for deps.fetch: records every request and answers from `routes` keyed by `METHOD path`.
 * An unrouted request answers 500 so a test notices it.
 */
export function fakeCreem(routes: Record<string, CreemRoute> = {}) {
  const requests: CreemRequest[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const raw = typeof init?.body === 'string' ? init.body : '';
    const req: CreemRequest = { method: init?.method ?? 'GET', path: url.pathname, headers, body: raw === '' ? null : JSON.parse(raw) };
    requests.push(req);
    const route = routes[`${req.method} ${req.path}`];
    const answer = route ? await route(req) : { status: 500, body: { error: `unrouted ${req.method} ${req.path}` } };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchFn, requests };
}

/** The creem-signature header value for a raw body. */
export function creemSignature(body: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** POST a signed Creem webhook through the route table. `signature` overrides the computed header. */
export function postWebhook(env: Env, deps: Deps, payload: unknown, opts: { signature?: string | null; ctx?: FakeCtx } = {}): Promise<Response> {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = opts.signature === undefined ? creemSignature(body) : opts.signature;
  return call('POST', '/webhooks/creem', {
    env,
    deps,
    headers: { 'content-type': 'application/json', ...(signature === null ? {} : { 'creem-signature': signature }) },
    body,
    ...(opts.ctx ? { ctx: opts.ctx } : {}),
  });
}
