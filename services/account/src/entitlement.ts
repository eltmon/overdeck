/**
 * Entitlement and storage cap (PRD PAN-4293 §7.13, D-26, D-27).
 *
 * entitlementFor() is the only entitlement source until PAN-4294 (billing) replaces its body;
 * its signature and the Entitlement shape stay fixed so no data migration is needed.
 * quotaDecision() is the rule the hosted vault (PAN-4297) enforces on every write.
 */
import type { GrantRow } from './grants.ts';

export const DEFAULT_STORAGE_CAP_BYTES = 5 * 1024 ** 3; // 5 GB

export interface Entitlement {
  plan: 'tester';
  storageBytesCap: number;
  maxDevices: number | null;
}

export function entitlementFor(grant: Pick<GrantRow, 'storage_cap_bytes'> | null): Entitlement {
  return { plan: 'tester', storageBytesCap: grant?.storage_cap_bytes ?? DEFAULT_STORAGE_CAP_BYTES, maxDevices: null };
}

export type QuotaDecision =
  | { allowed: true }
  | { allowed: false; reason: 'quota_exceeded'; capBytes: number; usedBytes: number };

export function quotaDecision(e: Entitlement, usedBytes: number, incomingBytes: number): QuotaDecision {
  return usedBytes + incomingBytes > e.storageBytesCap
    ? { allowed: false, reason: 'quota_exceeded', capBytes: e.storageBytesCap, usedBytes }
    : { allowed: true };
}
