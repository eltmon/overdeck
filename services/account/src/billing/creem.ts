/**
 * Creem REST client and webhook signature check (PRD PAN-4294 WI-3, D-2, IC-1, NFR-2, NFR-3).
 *
 * Every call goes through the injected `deps.fetch` with the `x-api-key` header and a JSON body, and gives up
 * after 10 seconds. Calls never throw: a non-2xx answer, a network error or an unexpected body becomes a
 * failure result the caller turns into a page or a retry. Web APIs only (Workers runtime).
 */
import type { Deps } from '../env.ts';
import type { BillingConfig } from './catalog.ts';

/** IC-1: the documented portal path. If Creem test mode answers 404, change it to '/v1/customer-portal'. */
export const CREEM_PORTAL_PATH = '/v1/customers/billing';
export const CREEM_TIMEOUT_MS = 10_000;

export type CreemFailure = { ok: false; status: number; detail: string };

/** Status used when Creem could not be reached or answered something unusable. */
const BAD_GATEWAY = 502;
const DETAIL_MAX = 200;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Creem reference field: the id string itself, or the `id` of an expanded object. */
export function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (isObject(value) && typeof value.id === 'string' && value.id !== '') return value.id;
  return null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

async function post(cfg: BillingConfig, deps: Deps, path: string, body: JsonObject): Promise<{ ok: true; json: JsonObject } | CreemFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREEM_TIMEOUT_MS);
  try {
    const res = await deps.fetch(`${cfg.apiBase}${path}`, {
      method: 'POST',
      headers: { 'x-api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, detail: text.slice(0, DETAIL_MAX) };
    let json: unknown;
    try {
      json = text === '' ? {} : JSON.parse(text);
    } catch {
      return { ok: false, status: BAD_GATEWAY, detail: 'Creem answered with a body that is not JSON' };
    }
    if (!isObject(json)) return { ok: false, status: BAD_GATEWAY, detail: 'Creem answered with a body that is not a JSON object' };
    return { ok: true, json };
  } catch (err) {
    return { ok: false, status: BAD_GATEWAY, detail: (err instanceof Error ? err.message : String(err)).slice(0, DETAIL_MAX) };
  } finally {
    clearTimeout(timer);
  }
}

export interface CheckoutInput {
  productId: string;
  /** Our checkout id; Creem echoes it on checkout.completed (D-8). */
  requestId: string;
  successUrl: string;
  metadata: Record<string, string>;
}

export type CheckoutResult = { ok: true; checkoutId: string; checkoutUrl: string } | CreemFailure;

/** POST /v1/checkouts. The checkout URL must be https, because the account page links to it (D-12). */
export async function createCheckout(cfg: BillingConfig, deps: Deps, input: CheckoutInput): Promise<CheckoutResult> {
  const res = await post(cfg, deps, '/v1/checkouts', {
    product_id: input.productId,
    request_id: input.requestId,
    success_url: input.successUrl,
    metadata: input.metadata,
  });
  if (!res.ok) return res;
  const checkoutId = typeof res.json.id === 'string' ? res.json.id : null;
  const checkoutUrl = httpsUrl(res.json.checkout_url);
  if (checkoutId === null || checkoutUrl === null) return { ok: false, status: BAD_GATEWAY, detail: 'Creem returned no id or no https checkout_url' };
  return { ok: true, checkoutId, checkoutUrl };
}

export type UpgradeResult = { ok: true; subscription: JsonObject } | CreemFailure;

/** POST /v1/subscriptions/{id}/upgrade: move the subscription to another product, charging the difference now (D-2). */
export async function upgradeSubscription(cfg: BillingConfig, deps: Deps, subscriptionId: string, productId: string): Promise<UpgradeResult> {
  const res = await post(cfg, deps, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/upgrade`, {
    product_id: productId,
    update_behavior: 'proration-charge-immediately',
  });
  return res.ok ? { ok: true, subscription: res.json } : res;
}

export type CancelResult = 'cancelled' | 'not_found' | { error: string };

/** POST /v1/subscriptions/{id}/cancel with mode immediate (D-11). A 404 means there is nothing left to cancel. */
export async function cancelSubscription(cfg: BillingConfig, deps: Deps, subscriptionId: string): Promise<CancelResult> {
  const res = await post(cfg, deps, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { mode: 'immediate' });
  if (res.ok) return 'cancelled';
  if (res.status === 404) return 'not_found';
  return { error: `${res.status} ${res.detail}`.trim().slice(0, DETAIL_MAX) };
}

export type PortalResult = { ok: true; url: string } | CreemFailure;

/** The Creem customer portal link (payment method, invoices, cancel). Only an https link is returned. */
export async function portalLink(cfg: BillingConfig, deps: Deps, customerId: string): Promise<PortalResult> {
  const res = await post(cfg, deps, CREEM_PORTAL_PATH, { customer_id: customerId });
  if (!res.ok) return res;
  const url = httpsUrl(res.json.customer_portal_link);
  return url === null ? { ok: false, status: BAD_GATEWAY, detail: 'Creem returned no https customer_portal_link' } : { ok: true, url };
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The `creem-signature` header is the lowercase hex HMAC-SHA256 of the raw body keyed by the webhook secret.
 * The comparison runs over the full length whatever the content, so timing does not reveal a prefix (NFR-2).
 */
export async function verifySignature(secret: string, rawBody: Uint8Array, header: string | null): Promise<boolean> {
  if (header === null) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = toHex(await crypto.subtle.sign('HMAC', key, rawBody));
  const given = header.trim();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
