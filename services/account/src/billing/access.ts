/**
 * Paid access and lapse from subscription rows (PRD PAN-4294 WI-2, D-6, D-7).
 *
 * Computed from stored timestamps and the caller's `now` at lookup time; no cron flips state (FR-5).
 */
import type { Lapse } from '../entitlement.ts';
import type { RequestContext } from '../env.ts';
import { isProductKey, type ProductKey } from './catalog.ts';

const DAY_MS = 86_400_000;
/** Creem keeps retrying a failed renewal; a `past_due` row keeps paid access this long after `paid_through`. */
export const PAST_DUE_GRACE_MS = 7 * DAY_MS;
/** After `lapsedAt`, hosted data stays readable for this long (D-7). */
export const GRACE_MS = 30 * DAY_MS;
/** After the grace period, the account page warns of deletion for this long before `deletesAt` (D-7). */
export const EXPORT_WINDOW_MS = 30 * DAY_MS;

export interface SubscriptionRow {
  subscription_id: string;
  user_id: string;
  customer_id: string;
  product_key: string;
  status: string;
  paid_through: number | null;
  founding: number;
  created_at: number;
  updated_at: number;
  last_event_at: number;
  revoked_at: number | null;
  cancel_requested_at: number | null;
  cancel_done_at: number | null;
  cancel_attempts: number;
  cancel_error: string | null;
}

/** The columns billingStateFor reads; `lookupDevice` selects only these. */
export type SubscriptionAccessRow = Pick<SubscriptionRow, 'subscription_id' | 'product_key' | 'status' | 'paid_through' | 'founding' | 'revoked_at'>;

export interface PaidSubscription {
  subscriptionId: string;
  productKey: ProductKey;
  paidThrough: number;
  status: string;
  founding: boolean;
}

export interface BillingState {
  /** The row giving paid access now (the one whose access lasts longest), or null. */
  paid: PaidSubscription | null;
  /** Set when no row gives paid access and a non-revoked row was paid for at some point. */
  lapse: Lapse | null;
  /** The paying row is `past_due`: Creem is retrying the card. */
  pastDue: boolean;
  /** Any non-revoked row exists: the account is a subscriber, so it stays allowed without a grant (FR-7). */
  hasLiveRow: boolean;
}

/** Statuses that keep paid access until `paid_through`. `canceled` too: the portal cancels at once, the period is paid. */
const PAID_STATUSES = new Set(['active', 'trialing', 'scheduled_cancel', 'canceled']);

/** When paid access ends for a row, or null when its status never gives access (D-6). */
function accessEnd(row: SubscriptionAccessRow & { paid_through: number }): number | null {
  if (PAID_STATUSES.has(row.status)) return row.paid_through;
  if (row.status === 'past_due') return row.paid_through + PAST_DUE_GRACE_MS;
  return null;
}

/** The latest time a row stopped (or will stop) giving access, for the lapse timeline (D-7). */
function lapseEnd(row: SubscriptionAccessRow & { paid_through: number }): number {
  return row.status === 'past_due' ? row.paid_through + PAST_DUE_GRACE_MS : row.paid_through;
}

export function billingStateFor(rows: readonly SubscriptionAccessRow[], now: number): BillingState {
  const live = rows.filter((r) => r.revoked_at === null);
  const hasLiveRow = live.length > 0;
  let paid: { row: SubscriptionAccessRow; productKey: ProductKey; paidThrough: number; end: number } | null = null;
  let lapsedAt: number | null = null;
  for (const row of live) {
    if (!isProductKey(row.product_key) || row.paid_through === null) continue;
    const withPaid = { ...row, paid_through: row.paid_through };
    const end = accessEnd(withPaid);
    if (end !== null && now < end && (paid === null || end > paid.end)) {
      paid = { row, productKey: row.product_key, paidThrough: row.paid_through, end };
    }
    const ended = lapseEnd(withPaid);
    if (lapsedAt === null || ended > lapsedAt) lapsedAt = ended;
  }
  if (paid !== null) {
    return {
      paid: {
        subscriptionId: paid.row.subscription_id,
        productKey: paid.productKey,
        paidThrough: paid.paidThrough,
        status: paid.row.status,
        founding: paid.row.founding === 1,
      },
      lapse: null,
      pastDue: paid.row.status === 'past_due',
      hasLiveRow,
    };
  }
  const lapse = lapsedAt === null ? null : { lapsedAt, graceEndsAt: lapsedAt + GRACE_MS, deletesAt: lapsedAt + GRACE_MS + EXPORT_WINDOW_MS };
  return { paid: null, lapse, pastDue: false, hasLiveRow };
}

/** Every subscription row of a user, newest first. */
export async function loadSubscriptions(rc: Pick<RequestContext, 'env'>, userId: string): Promise<SubscriptionRow[]> {
  const result = await rc.env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<SubscriptionRow>();
  return result.results;
}
