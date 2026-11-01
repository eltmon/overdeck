/**
 * The month's provider requests as hashes, for fleet usage (PAN-4651 FR-8,
 * D-4651-19).
 *
 * A request recorded on two machines (a pulled transcript reconciled on its
 * new owner) would be counted twice in an "All machines" total. Each machine
 * serves `[first 16 hex of SHA-256(request_id), ts ms, cost]` for every event
 * in the same 30-day window `GET /api/costs/summary` sums, so the viewer can
 * subtract the cost of a hash an earlier machine already counted. Events
 * without a request id cannot be matched and are left out. At most 50,000
 * entries; beyond that `complete` is false.
 */
import { createHash } from 'node:crypto';

import { type CostEvent, readEventsSince } from './events.js';

export const REQUEST_DIGEST_CAP = 50_000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export type RequestDigestEntry = [hash: string, tsMs: number, cost: number];

export interface RequestDigest {
  since: string;
  entries: RequestDigestEntry[];
  complete: boolean;
}

export function requestHash(requestId: string): string {
  return createHash('sha256').update(requestId).digest('hex').slice(0, 16);
}

/** The start of the summary's month window (a date, as `GET /api/costs/summary` computes it). */
export function monthWindowStart(now: number = Date.now()): string {
  return new Date(now - MONTH_MS).toISOString().split('T')[0]!;
}

export function buildRequestDigest(events: readonly Pick<CostEvent, 'requestId' | 'ts' | 'cost'>[], since: string, cap: number = REQUEST_DIGEST_CAP): RequestDigest {
  const entries: RequestDigestEntry[] = [];
  let complete = true;
  for (const event of events) {
    if (!event.requestId) continue;
    if (entries.length >= cap) {
      complete = false;
      break;
    }
    entries.push([requestHash(event.requestId), Date.parse(event.ts) || 0, event.cost || 0]);
  }
  return { since, entries, complete };
}

export async function readRequestDigest(now: number = Date.now()): Promise<RequestDigest> {
  const since = monthWindowStart(now);
  return buildRequestDigest(await readEventsSince(since), since);
}

export interface UsageWindow {
  totalCost: number;
  totalTokens: number;
  entryCount: number;
}

export interface UsageWindows {
  today: UsageWindow;
  week: UsageWindow;
  month: UsageWindow;
}

/** The three window starts `GET /api/costs/summary` uses (UTC dates). */
export function usageWindowStarts(now: number = Date.now()): { today: string; week: string; month: string } {
  const day = (ms: number) => new Date(ms).toISOString().split('T')[0]!;
  return { today: day(now), week: day(now - 7 * 24 * 60 * 60 * 1000), month: day(now - MONTH_MS) };
}

/** Which windows an event at `ts` (ISO or ms) falls in. */
export function windowsOf(ts: string | number, now: number = Date.now()): Array<keyof UsageWindows> {
  const iso = typeof ts === 'number' ? new Date(ts).toISOString() : ts;
  const starts = usageWindowStarts(now);
  return (['today', 'week', 'month'] as const).filter((window) => iso >= starts[window]);
}

/** This machine's usage windows and request digest from one scan of the month window (FR-8). */
export async function readLocalUsage(now: number = Date.now()): Promise<{ windows: UsageWindows; digest: RequestDigest }> {
  const since = monthWindowStart(now);
  const events = await readEventsSince(since);
  const windows: UsageWindows = {
    today: { totalCost: 0, totalTokens: 0, entryCount: 0 },
    week: { totalCost: 0, totalTokens: 0, entryCount: 0 },
    month: { totalCost: 0, totalTokens: 0, entryCount: 0 },
  };
  for (const event of events) {
    const tokens = (event.input || 0) + (event.output || 0) + (event.cacheRead || 0) + (event.cacheWrite || 0);
    for (const window of event.ts === undefined ? ['today', 'week', 'month'] as const : windowsOf(event.ts, now)) {
      windows[window].totalCost += event.cost || 0;
      windows[window].totalTokens += tokens;
      windows[window].entryCount += 1;
    }
  }
  return { windows, digest: buildRequestDigest(events, since) };
}
