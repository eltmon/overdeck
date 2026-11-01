/**
 * Entitlement and storage cap (PRD PAN-4293 §7.13, D-26, D-27).
 *
 * entitlementFor() is the only entitlement source until PAN-4294 (billing) replaces its body;
 * its signature and the Entitlement shape stay fixed so no data migration is needed.
 * quotaDecision() is the rule the hosted vault (PAN-4297) enforces on every write.
 */
import type { GrantRow } from './grants.ts';

export const DEFAULT_STORAGE_CAP_BYTES = 5 * 1024 ** 3; // 5 GB
/** Machines a `free` account may register in the connect directory (PAN-2356 D-2356-3). */
export const FREE_PLAN_MAX_MACHINES = 3;

export interface Entitlement {
  plan: 'free' | 'tester';
  storageBytesCap: number;
  maxDevices: number | null;
}

/** A grant whose `entitlement` column is `'free'` is the free plan; any other value, and the owner, is `tester`. */
export function entitlementFor(grant: Pick<GrantRow, 'storage_cap_bytes' | 'entitlement'> | null): Entitlement {
  const storageBytesCap = grant?.storage_cap_bytes ?? DEFAULT_STORAGE_CAP_BYTES;
  return grant?.entitlement === 'free'
    ? { plan: 'free', storageBytesCap, maxDevices: FREE_PLAN_MAX_MACHINES }
    : { plan: 'tester', storageBytesCap, maxDevices: null };
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: 'quota_exceeded'; capBytes: number; usedBytes: number };

export function quotaDecision(e: Entitlement, usedBytes: number, incomingBytes: number): QuotaDecision {
  return usedBytes + incomingBytes > e.storageBytesCap
    ? { allowed: false, reason: 'quota_exceeded', capBytes: e.storageBytesCap, usedBytes }
    : { allowed: true };
}
