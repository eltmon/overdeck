/**
 * Entitlement and storage cap (PRD PAN-4293 §7.13, D-26, D-27; PAN-4294 D-5).
 *
 * entitlementFor() is the one entitlement source every hosted service asks. PAN-4294 widened it with the
 * subscription state: new fields are additive and `entitlementFor(grant)` alone keeps its old meaning.
 * quotaDecision() is the rule the hosted vault (PAN-4297) enforces on every write.
 */
import { PRODUCTS } from './billing/catalog.ts';
import type { BillingState } from './billing/access.ts';
import type { GrantRow } from './grants.ts';

export const DEFAULT_STORAGE_CAP_BYTES = 5 * 1024 ** 3; // 5 GiB
/** Hosted-vault cap of the free plan (PAN-4294 D-5). */
export const FREE_STORAGE_CAP_BYTES = 1024 ** 3; // 1 GiB
/** Hosted-vault cap of the paid Anywhere plan (PAN-4294 D-5). */
export const ANYWHERE_STORAGE_CAP_BYTES = 100 * 1024 ** 3; // 100 GiB
/** Machines a `free` account may register in the connect directory (PAN-2356 D-2356-3). */
export const FREE_PLAN_MAX_MACHINES = 3;
/** Machines a `free` account may sync to the hosted vault (PAN-4294 D-5). */
export const FREE_VAULT_MAX_MACHINES = 2;

/** The lapse timeline of an account whose subscription ended (PAN-4294 D-7). All ms since epoch. */
export interface Lapse {
  lapsedAt: number;
  graceEndsAt: number;
  deletesAt: number;
}

export interface Entitlement {
  plan: 'free' | 'tester' | 'anywhere';
  storageBytesCap: number;
  /** Directory machines; null = unlimited. */
  maxDevices: number | null;
  /** Relay fallback allowed. */
  relay: boolean;
  /** Webhook inbox allowed. */
  inbox: boolean;
  /** Machines syncing the hosted vault; null = unlimited. */
  vaultMaxMachines: number | null;
  /** Only when plan is 'free' and a lapsed subscription exists. */
  lapse: Lapse | null;
}

type GrantPick = Pick<GrantRow, 'storage_cap_bytes' | 'entitlement'>;

function freeEntitlement(storageBytesCap: number, lapse: Lapse | null): Entitlement {
  return { plan: 'free', storageBytesCap, maxDevices: FREE_PLAN_MAX_MACHINES, relay: false, inbox: false, vaultMaxMachines: FREE_VAULT_MAX_MACHINES, lapse };
}

function testerEntitlement(storageBytesCap: number): Entitlement {
  return { plan: 'tester', storageBytesCap, maxDevices: null, relay: true, inbox: true, vaultMaxMachines: null, lapse: null };
}

/**
 * D-5 precedence, first match wins: paid access → `anywhere`; the owner → `tester`; an active `free` grant →
 * `free`; any other active grant → `tester`; a subscriber without a grant → `free`. With neither grant nor
 * billing the result is the default `tester` row, which is how callers have always described the owner.
 */
export function entitlementFor(grant: GrantPick | null, billing: BillingState | null = null, owner = false): Entitlement {
  if (billing?.paid) {
    return {
      plan: 'anywhere',
      storageBytesCap: Math.max(ANYWHERE_STORAGE_CAP_BYTES, grant?.storage_cap_bytes ?? 0),
      maxDevices: null,
      relay: PRODUCTS[billing.paid.productKey].relay,
      inbox: true,
      vaultMaxMachines: null,
      lapse: null,
    };
  }
  if (owner) return testerEntitlement(DEFAULT_STORAGE_CAP_BYTES);
  if (grant?.entitlement === 'free') return freeEntitlement(grant.storage_cap_bytes ?? FREE_STORAGE_CAP_BYTES, billing?.lapse ?? null);
  if (grant !== null) return testerEntitlement(grant.storage_cap_bytes ?? DEFAULT_STORAGE_CAP_BYTES);
  if (billing?.hasLiveRow) return freeEntitlement(FREE_STORAGE_CAP_BYTES, billing.lapse);
  return testerEntitlement(DEFAULT_STORAGE_CAP_BYTES);
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: 'quota_exceeded'; capBytes: number; usedBytes: number };

export function quotaDecision(e: Entitlement, usedBytes: number, incomingBytes: number): QuotaDecision {
  return usedBytes + incomingBytes > e.storageBytesCap
    ? { allowed: false, reason: 'quota_exceeded', capBytes: e.storageBytesCap, usedBytes }
    : { allowed: true };
}
