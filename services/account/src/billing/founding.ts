/**
 * The founding-price availability rule (PRD PAN-4294 FR-3, D-10), shared by the checkout reservation INSERT
 * and the account page, so both count the same way.
 */
import type { RequestContext } from '../env.ts';
import { FOUNDING_LIMIT, type BillingConfig } from './catalog.ts';

/** The SQL condition "a founding place is free now": sold rows plus live reservations under the limit, before the end date. */
export const FOUNDING_OPEN_SQL = `(SELECT COUNT(*) FROM subscriptions WHERE founding = 1)
       + (SELECT COUNT(*) FROM checkouts WHERE founding = 1 AND completed_at IS NULL AND expires_at > ?) < ${FOUNDING_LIMIT}
     AND (? IS NULL OR ? < ?)`;

/** Founding places left now: the same count and end-date rule the reservation INSERT uses (FR-3). */
export async function foundingAvailability(rc: Pick<RequestContext, 'env' | 'deps'>, cfg: BillingConfig): Promise<{ available: boolean; placesLeft: number }> {
  const now = rc.deps.now();
  const taken = await rc.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM subscriptions WHERE founding = 1)
          + (SELECT COUNT(*) FROM checkouts WHERE founding = 1 AND completed_at IS NULL AND expires_at > ?) AS taken`,
  )
    .bind(now)
    .first<number>('taken');
  const placesLeft = Math.max(0, FOUNDING_LIMIT - (taken ?? 0));
  const beforeEnd = cfg.foundingEndsAt === null || now < cfg.foundingEndsAt;
  return { available: placesLeft > 0 && beforeEnd, placesLeft };
}
