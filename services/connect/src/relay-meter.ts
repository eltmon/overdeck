/**
 * Relay metering (PRD PAN-2356 D-2356-12, OD-3): ciphertext bytes per account per UTC calendar
 * month, reported by the machine that requested the TURN credentials. A month's total at or past
 * the cap stops the relay until the next month.
 */
import { RELAY_MONTHLY_CAP_BYTES } from '../../../packages/contracts/src/connect.ts';
import type { RelayStatus } from '../../../packages/contracts/src/connect.ts';

/** A row of the `relay_usage` table. */
export interface RelayUsage {
  /** UTC calendar month, `YYYY-MM`. */
  readonly month: string;
  readonly bytes: number;
}

/** UTC calendar month of `now`, `YYYY-MM`. */
export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** Bytes used in the month of `now`; a row from an earlier month counts as zero. */
export function bytesThisMonth(usage: RelayUsage | null, now: number): number {
  return usage !== null && usage.month === monthOf(now) ? usage.bytes : 0;
}

export function relayStatusOf(usage: RelayUsage | null, now: number, capBytes: number): RelayStatus {
  const bytesUsed = bytesThisMonth(usage, now);
  return { month: monthOf(now), bytesUsed, capBytes, stopped: bytesUsed >= capBytes };
}

/** The new row after a report of `bytes`, and whether this report is the one that reached the cap. */
export function addUsage(usage: RelayUsage | null, bytes: number, now: number, capBytes: number): { usage: RelayUsage; reachedCap: boolean } {
  const before = bytesThisMonth(usage, now);
  const after = before + bytes;
  return { usage: { month: monthOf(now), bytes: after }, reachedCap: before < capBytes && after >= capBytes };
}

/** The `RELAY_CAP_BYTES` var (a positive integer, for staging tests) or the 50 GB contract cap. */
export function relayCapBytes(raw: string | undefined): number {
  if (raw === undefined || !/^[1-9][0-9]{0,15}$/.test(raw.trim())) return RELAY_MONTHLY_CAP_BYTES;
  return Number(raw.trim());
}
