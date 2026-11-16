/**
 * Cancel Creem subscriptions on account deletion and operator revoke (PRD PAN-4294 WI-7, FR-11, D-11).
 *
 * A cancel is requested by setting `cancel_requested_at`; runPendingCancels sends it (mode immediate) and records
 * the outcome on the row. A failed cancel keeps its row pending, so the hourly cron sends it again, and the admin
 * screen lists it with its error. No refund is issued by code.
 */
import type { RequestContext } from '../env.ts';
import type { BillingConfig } from './catalog.ts';
import { cancelSubscription } from './creem.ts';

export type CancelContext = Pick<RequestContext, 'env' | 'deps'>;

/** Rows a single pass handles, well under the Workers subrequest limit. The next pass takes the rest. */
export const CANCEL_BATCH = 40;
const ERROR_MAX = 200;

/** Statuses that need no cancel: Creem already ended them. */
const ENDED_STATUSES = "('canceled', 'expired')";

/** Send every requested, not yet done cancel (only the user's when `userId` is given). Returns how many remain pending. */
export async function runPendingCancels(rc: CancelContext, cfg: BillingConfig, userId?: string): Promise<number> {
  const db = rc.env.DB;
  const filter = userId === undefined ? '' : ' AND user_id = ?';
  const pendingSql = `FROM subscriptions WHERE cancel_requested_at IS NOT NULL AND cancel_done_at IS NULL${filter}`;
  const bind = <T extends D1PreparedStatement>(stmt: T): T => (userId === undefined ? stmt : (stmt.bind(userId) as T));
  const rows = await bind(db.prepare(`SELECT subscription_id ${pendingSql} ORDER BY cancel_requested_at LIMIT ${CANCEL_BATCH}`)).all<{ subscription_id: string }>();
  for (const { subscription_id: subscriptionId } of rows.results) {
    const outcome = await cancelSubscription(cfg, rc.deps, subscriptionId);
    if (outcome === 'cancelled' || outcome === 'not_found') {
      await db.prepare('UPDATE subscriptions SET cancel_done_at = ?, cancel_error = NULL WHERE subscription_id = ?').bind(rc.deps.now(), subscriptionId).run();
    } else {
      await db.prepare('UPDATE subscriptions SET cancel_attempts = cancel_attempts + 1, cancel_error = ? WHERE subscription_id = ?')
        .bind(outcome.error.slice(0, ERROR_MAX), subscriptionId)
        .run();
    }
  }
  return (await bind(db.prepare(`SELECT COUNT(*) AS n ${pendingSql}`)).first<number>('n')) ?? 0;
}

/** Request a cancel for each of the user's subscriptions Creem has not ended, then send them. True when none remain pending. */
export async function cancelForUser(rc: CancelContext, cfg: BillingConfig, userId: string): Promise<boolean> {
  await rc.env.DB.prepare(
    `UPDATE subscriptions SET cancel_requested_at = COALESCE(cancel_requested_at, ?)
     WHERE user_id = ? AND cancel_done_at IS NULL AND status NOT IN ${ENDED_STATUSES}`,
  )
    .bind(rc.deps.now(), userId)
    .run();
  return (await runPendingCancels(rc, cfg, userId)) === 0;
}
