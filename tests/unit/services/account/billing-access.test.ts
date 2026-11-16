import { describe, expect, it } from 'vitest';
import {
  billingStateFor,
  EXPORT_WINDOW_MS,
  GRACE_MS,
  PAST_DUE_GRACE_MS,
  type BillingState,
  type SubscriptionAccessRow,
} from '../../../../services/account/src/billing/access.ts';
import {
  ANYWHERE_STORAGE_CAP_BYTES,
  DEFAULT_STORAGE_CAP_BYTES,
  FREE_STORAGE_CAP_BYTES,
  entitlementFor,
} from '../../../../services/account/src/entitlement.ts';

const DAY = 86_400_000;
const PAID_THROUGH = Date.UTC(2027, 0, 2);

function row(overrides: Partial<SubscriptionAccessRow> = {}): SubscriptionAccessRow {
  return {
    subscription_id: 'sub_1',
    product_key: 'anywhere_annual',
    status: 'active',
    paid_through: PAID_THROUGH,
    founding: 0,
    revoked_at: null,
    ...overrides,
  };
}

function lapseAt(lapsedAt: number) {
  return { lapsedAt, graceEndsAt: lapsedAt + 30 * DAY, deletesAt: lapsedAt + 60 * DAY };
}

describe('paid access (PAN-4294 D-6)', () => {
  it('keeps the decided durations', () => {
    expect(PAST_DUE_GRACE_MS).toBe(7 * DAY);
    expect(GRACE_MS).toBe(30 * DAY);
    expect(EXPORT_WINDOW_MS).toBe(30 * DAY);
  });

  it.each(['active', 'trialing', 'scheduled_cancel', 'canceled'])('%s gives paid access until paid_through and lapses at it', (status) => {
    const before = billingStateFor([row({ status })], PAID_THROUGH - 1);
    expect(before.paid).toEqual({ subscriptionId: 'sub_1', productKey: 'anywhere_annual', paidThrough: PAID_THROUGH, status, founding: false });
    expect(before.lapse).toBeNull();
    const after = billingStateFor([row({ status })], PAID_THROUGH + 1);
    expect(after.paid).toBeNull();
    expect(after.lapse).toEqual(lapseAt(PAID_THROUGH));
  });

  it('past_due keeps access for 7 more days, then lapses at paid_through + 7 days', () => {
    const paid = billingStateFor([row({ status: 'past_due' })], PAID_THROUGH + 7 * DAY - 1);
    expect(paid.paid?.status).toBe('past_due');
    expect(paid.pastDue).toBe(true);
    const lapsed = billingStateFor([row({ status: 'past_due' })], PAID_THROUGH + 7 * DAY);
    expect(lapsed.paid).toBeNull();
    expect(lapsed.pastDue).toBe(false);
    expect(lapsed.lapse).toEqual(lapseAt(PAID_THROUGH + 7 * DAY));
  });

  it.each(['paused', 'unpaid', 'expired', 'mystery'])('%s gives no paid access even before paid_through', (status) => {
    const state = billingStateFor([row({ status })], PAID_THROUGH - DAY);
    expect(state.paid).toBeNull();
    expect(state.hasLiveRow).toBe(true);
    expect(state.lapse).toEqual(lapseAt(PAID_THROUGH));
  });

  it('with two lapsed rows the latest access end wins', () => {
    const state = billingStateFor(
      [row({ subscription_id: 'sub_old', paid_through: PAID_THROUGH - 100 * DAY }), row({ subscription_id: 'sub_new', status: 'past_due' })],
      PAID_THROUGH + 10 * DAY,
    );
    expect(state.lapse).toEqual(lapseAt(PAID_THROUGH + 7 * DAY));
  });

  it('a paid row beats a lapsed one and carries founding', () => {
    const state = billingStateFor(
      [row({ subscription_id: 'sub_old', paid_through: PAID_THROUGH - 100 * DAY }), row({ subscription_id: 'sub_f', product_key: 'founding_annual_relay', founding: 1 })],
      PAID_THROUGH - DAY,
    );
    expect(state.paid).toMatchObject({ subscriptionId: 'sub_f', productKey: 'founding_annual_relay', founding: true });
    expect(state.lapse).toBeNull();
  });

  it('ignores revoked rows and rows with an unknown product key', () => {
    const revoked = billingStateFor([row({ revoked_at: 5 })], PAID_THROUGH - DAY);
    expect(revoked).toEqual({ paid: null, lapse: null, pastDue: false, hasLiveRow: false });
    const unknown = billingStateFor([row({ product_key: 'storage_addon' })], PAID_THROUGH - DAY);
    expect(unknown.paid).toBeNull();
    expect(unknown.lapse).toBeNull();
  });

  it('a row without paid_through gives no access and no lapse', () => {
    expect(billingStateFor([row({ paid_through: null })], PAID_THROUGH)).toEqual({ paid: null, lapse: null, pastDue: false, hasLiveRow: true });
  });

  it('no rows is no billing at all', () => {
    expect(billingStateFor([], PAID_THROUGH)).toEqual({ paid: null, lapse: null, pastDue: false, hasLiveRow: false });
  });

  it('graceEndsAt and deletesAt are exactly +30 and +60 days', () => {
    const lapse = billingStateFor([row()], PAID_THROUGH + 1).lapse;
    expect(lapse?.graceEndsAt).toBe(PAID_THROUGH + 30 * DAY);
    expect(lapse?.deletesAt).toBe(PAID_THROUGH + 60 * DAY);
  });
});

describe('entitlement precedence (PAN-4294 D-5)', () => {
  const lapse = lapseAt(PAID_THROUGH);
  const paid = (productKey: SubscriptionAccessRow['product_key']): BillingState => billingStateFor([row({ product_key: productKey })], PAID_THROUGH - DAY);
  const lapsedLive: BillingState = { paid: null, lapse, pastDue: false, hasLiveRow: true };

  it('paid access is anywhere for any account, with the relay from the product and the larger cap', () => {
    const anywhere = { plan: 'anywhere', maxDevices: null, inbox: true, vaultMaxMachines: null, lapse: null };
    expect(entitlementFor(null, paid('anywhere_annual'))).toEqual({ ...anywhere, storageBytesCap: ANYWHERE_STORAGE_CAP_BYTES, relay: false });
    expect(entitlementFor(null, paid('anywhere_monthly_relay'), true)).toEqual({ ...anywhere, storageBytesCap: ANYWHERE_STORAGE_CAP_BYTES, relay: true });
    expect(entitlementFor({ storage_cap_bytes: 200 * 1024 ** 3, entitlement: 'free' }, paid('anywhere_annual'))).toEqual({
      ...anywhere,
      storageBytesCap: 200 * 1024 ** 3,
      relay: false,
    });
    expect(ANYWHERE_STORAGE_CAP_BYTES).toBe(100 * 1024 ** 3);
  });

  it('the owner without paid access is tester with the 5 GiB cap', () => {
    expect(entitlementFor({ storage_cap_bytes: null, entitlement: 'free' }, lapsedLive, true)).toEqual({
      plan: 'tester', storageBytesCap: DEFAULT_STORAGE_CAP_BYTES, maxDevices: null, relay: true, inbox: true, vaultMaxMachines: null, lapse: null,
    });
  });

  it('an active free grant is free, with the grant cap or 1 GiB and the lapse from billing', () => {
    expect(entitlementFor({ storage_cap_bytes: null, entitlement: 'free' }, lapsedLive)).toEqual({
      plan: 'free', storageBytesCap: FREE_STORAGE_CAP_BYTES, maxDevices: 3, relay: false, inbox: false, vaultMaxMachines: 2, lapse,
    });
    expect(entitlementFor({ storage_cap_bytes: 7, entitlement: 'free' })).toMatchObject({ plan: 'free', storageBytesCap: 7, lapse: null });
    expect(FREE_STORAGE_CAP_BYTES).toBe(1024 ** 3);
  });

  it('any other active grant is tester, with the grant cap or 5 GiB, and never carries a lapse', () => {
    expect(entitlementFor({ storage_cap_bytes: null, entitlement: 'tester' }, lapsedLive)).toEqual({
      plan: 'tester', storageBytesCap: DEFAULT_STORAGE_CAP_BYTES, maxDevices: null, relay: true, inbox: true, vaultMaxMachines: null, lapse: null,
    });
    expect(entitlementFor({ storage_cap_bytes: 9, entitlement: 'beta' })).toMatchObject({ plan: 'tester', storageBytesCap: 9 });
  });

  it('no active grant and a non-revoked subscription row is free with the 1 GiB cap and the lapse', () => {
    expect(entitlementFor(null, lapsedLive)).toEqual({
      plan: 'free', storageBytesCap: FREE_STORAGE_CAP_BYTES, maxDevices: 3, relay: false, inbox: false, vaultMaxMachines: 2, lapse,
    });
  });
});
