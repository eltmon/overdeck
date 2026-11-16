/**
 * Billing fixtures for the account-service unit tests (PAN-4294).
 */
import type { Env } from '../../../../../services/account/src/env.ts';

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
