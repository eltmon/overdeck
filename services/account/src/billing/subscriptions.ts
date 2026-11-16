/**
 * Apply one verified Creem webhook event to the subscription tables (PRD PAN-4294 WI-4, D-6, D-8, D-9).
 *
 * Mapping never depends on Creem copying checkout metadata onto subscriptions (IC-2) and never uses email.
 * Every applied or ignored event is written to `billing_events` in the same `DB.batch` as its row change, so a
 * failed apply leaves nothing behind and Creem's retry applies it again. An unresolved subscription event is
 * answered 503 (Creem retries) and kept in `billing_unresolved` for the admin screen, without a `billing_events` row.
 */
import type { RequestContext } from '../env.ts';
import { PRODUCTS, type BillingConfig, type ProductKey } from './catalog.ts';
import { idOf } from './creem.ts';

export interface CreemEnvelope {
  id: string;
  eventType: string;
  /** ms since epoch, when Creem created the event. */
  created_at: number;
  object: Record<string, unknown>;
}

export interface ApplyResult {
  status: 200 | 503;
  body: Record<string, unknown>;
}

/** The subscription.* events that carry a subscription object and update its row. */
export const SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
  'subscription.active',
  'subscription.paid',
  'subscription.canceled',
  'subscription.scheduled_cancel',
  'subscription.past_due',
  'subscription.unpaid',
  'subscription.expired',
  'subscription.update',
  'subscription.trialing',
  'subscription.paused',
]);

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function metadataOf(object: Obj): Obj {
  return isObject(object.metadata) ? object.metadata : {};
}

function periodEnd(subscription: Obj): number | null {
  const raw = str(subscription.current_period_end_date);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function recordEvent(rc: Pick<RequestContext, 'env'>, env: CreemEnvelope, now: number): D1PreparedStatement {
  return rc.env.DB.prepare('INSERT INTO billing_events (event_id, event_type, received_at) VALUES (?, ?, ?)').bind(env.id, env.eventType, now);
}

function clearUnresolved(rc: Pick<RequestContext, 'env'>, env: CreemEnvelope): D1PreparedStatement {
  return rc.env.DB.prepare('DELETE FROM billing_unresolved WHERE event_id = ?').bind(env.id);
}

/** Record the event without changing any row: it is not ours, or it changes nothing. */
async function ignore(rc: RequestContext, env: CreemEnvelope, reason: string): Promise<ApplyResult> {
  const now = rc.deps.now();
  await rc.env.DB.batch([clearUnresolved(rc, env), recordEvent(rc, env, now)]);
  return { status: 200, body: { ok: true, ignored: reason } };
}

/** The user exists and is not deleted. */
async function liveUser(rc: RequestContext, userId: string): Promise<boolean> {
  const row = await rc.env.DB.prepare('SELECT deleted_at FROM users WHERE user_id = ?').bind(userId).first<{ deleted_at: number | null }>();
  return row !== null && row.deleted_at === null;
}

interface SubscriptionWrite {
  subscriptionId: string;
  userId: string;
  productKey: ProductKey;
  subscription: Obj;
  /** Only subscription.paid and checkout.completed move paid_through (D-6). */
  advancesPaidThrough: boolean;
  eventType: string;
}

/**
 * Insert the row, or update it. Product, status and customer change only when this event is not older than the
 * last one applied (D-9). paid_through is a forward-only maximum, so it applies whatever the delivery order: a
 * `subscription.paid` delivered after a newer `subscription.active` must still grant the paid period.
 */
function upsertSubscription(rc: RequestContext, env: CreemEnvelope, w: SubscriptionWrite): D1PreparedStatement {
  const now = rc.deps.now();
  const status = str(w.subscription.status) ?? w.eventType.replace(/^subscription\./, '');
  const customerId = idOf(w.subscription.customer) ?? '';
  const paidThrough = w.advancesPaidThrough ? periodEnd(w.subscription) : null;
  return rc.env.DB.prepare(
    `INSERT INTO subscriptions (subscription_id, user_id, customer_id, product_key, status, paid_through, founding, created_at, updated_at, last_event_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (subscription_id) DO UPDATE SET
       product_key = CASE WHEN excluded.last_event_at >= subscriptions.last_event_at THEN excluded.product_key ELSE subscriptions.product_key END,
       status = CASE WHEN excluded.last_event_at >= subscriptions.last_event_at THEN excluded.status ELSE subscriptions.status END,
       customer_id = CASE WHEN excluded.last_event_at >= subscriptions.last_event_at AND excluded.customer_id <> ''
         THEN excluded.customer_id ELSE subscriptions.customer_id END,
       paid_through = CASE
         WHEN excluded.paid_through IS NULL THEN subscriptions.paid_through
         WHEN subscriptions.paid_through IS NULL THEN excluded.paid_through
         ELSE MAX(subscriptions.paid_through, excluded.paid_through) END,
       updated_at = excluded.updated_at,
       last_event_at = MAX(subscriptions.last_event_at, excluded.last_event_at)`,
  ).bind(
    w.subscriptionId,
    w.userId,
    customerId,
    w.productKey,
    status,
    paidThrough,
    PRODUCTS[w.productKey].founding ? 1 : 0,
    now,
    now,
    env.created_at,
  );
}

async function checkoutUser(rc: RequestContext, sql: string, value: string | null): Promise<string | null> {
  if (value === null) return null;
  return rc.env.DB.prepare(sql).bind(value).first<string>('user_id');
}

/** D-8 order: metadata user id, our existing row, the checkout that created it, the checkout named in metadata. */
async function resolveSubscriptionUser(rc: RequestContext, subscriptionId: string, object: Obj): Promise<string | null> {
  const meta = metadataOf(object);
  const fromMeta = str(meta.overdeck_user_id);
  if (fromMeta !== null) return fromMeta;
  return (
    (await checkoutUser(rc, 'SELECT user_id FROM subscriptions WHERE subscription_id = ?', subscriptionId)) ??
    (await checkoutUser(rc, 'SELECT user_id FROM checkouts WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 1', subscriptionId)) ??
    (await checkoutUser(rc, 'SELECT user_id FROM checkouts WHERE checkout_id = ?', str(meta.overdeck_checkout_id)))
  );
}

async function applySubscriptionEvent(rc: RequestContext, cfg: BillingConfig, env: CreemEnvelope): Promise<ApplyResult> {
  const subscription = env.object;
  const subscriptionId = str(subscription.id);
  if (subscriptionId === null) return ignore(rc, env, 'no_subscription_id');
  const productId = idOf(subscription.product);
  const productKey = productId === null ? undefined : cfg.productKeyById.get(productId);
  if (productKey === undefined) return ignore(rc, env, 'unknown_product');

  const userId = await resolveSubscriptionUser(rc, subscriptionId, subscription);
  if (userId === null) {
    const now = rc.deps.now();
    await rc.env.DB.prepare(
      `INSERT INTO billing_unresolved (event_id, event_type, subscription_id, first_seen_at, last_seen_at, attempts)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (event_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, attempts = billing_unresolved.attempts + 1`,
    )
      .bind(env.id, env.eventType, subscriptionId, now, now)
      .run();
    return { status: 503, body: { error: 'unknown_subscription' } };
  }
  if (!(await liveUser(rc, userId))) return ignore(rc, env, 'unknown_user');

  const now = rc.deps.now();
  await rc.env.DB.batch([
    upsertSubscription(rc, env, {
      subscriptionId,
      userId,
      productKey,
      subscription,
      advancesPaidThrough: env.eventType === 'subscription.paid',
      eventType: env.eventType,
    }),
    clearUnresolved(rc, env),
    recordEvent(rc, env, now),
  ]);
  return { status: 200, body: { ok: true } };
}

async function findCheckout(rc: RequestContext, checkoutId: string | null): Promise<{ checkout_id: string; user_id: string } | null> {
  if (checkoutId === null) return null;
  return rc.env.DB.prepare('SELECT checkout_id, user_id FROM checkouts WHERE checkout_id = ?').bind(checkoutId).first<{ checkout_id: string; user_id: string }>();
}

async function applyCheckoutCompleted(rc: RequestContext, cfg: BillingConfig, env: CreemEnvelope): Promise<ApplyResult> {
  const checkout = env.object;
  const meta = metadataOf(checkout);
  // We send request_id = our checkout id and Creem echoes it; metadata is the fallback (D-8).
  const row = (await findCheckout(rc, str(checkout.request_id))) ?? (await findCheckout(rc, str(meta.overdeck_checkout_id)));
  const userId = row?.user_id ?? str(meta.overdeck_user_id);
  if (userId === null) return ignore(rc, env, 'not_ours');
  if (!(await liveUser(rc, userId))) return ignore(rc, env, 'unknown_user');

  const now = rc.deps.now();
  const subscriptionId = idOf(checkout.subscription);
  const writes: D1PreparedStatement[] = [];
  if (row) {
    writes.push(
      rc.env.DB.prepare(
        'UPDATE checkouts SET completed_at = COALESCE(completed_at, ?), creem_checkout_id = ?, subscription_id = COALESCE(?, subscription_id) WHERE checkout_id = ?',
      ).bind(now, str(checkout.id), subscriptionId, row.checkout_id),
    );
  }
  if (isObject(checkout.subscription) && subscriptionId !== null) {
    const productId = idOf(checkout.subscription.product) ?? idOf(checkout.product);
    const productKey = productId === null ? undefined : cfg.productKeyById.get(productId);
    if (productKey !== undefined) {
      // The checkout carries the customer when its embedded subscription does not.
      const subscription = checkout.subscription.customer === undefined ? { ...checkout.subscription, customer: checkout.customer } : checkout.subscription;
      writes.push(
        upsertSubscription(rc, env, { subscriptionId, userId, productKey, subscription, advancesPaidThrough: true, eventType: env.eventType }),
      );
    }
  }
  writes.push(clearUnresolved(rc, env), recordEvent(rc, env, now));
  await rc.env.DB.batch(writes);
  return { status: 200, body: { ok: true } };
}

/** Apply a verified, not-yet-seen event. Event types this service does not use are recorded and ignored. */
export async function applyEvent(rc: RequestContext, cfg: BillingConfig, env: CreemEnvelope): Promise<ApplyResult> {
  if (env.eventType === 'checkout.completed') return applyCheckoutCompleted(rc, cfg, env);
  if (SUBSCRIPTION_EVENTS.has(env.eventType)) return applySubscriptionEvent(rc, cfg, env);
  return ignore(rc, env, 'event_type');
}
