/**
 * merge-sync-time.ts — timestamp conversion shared by the merge-domain sync
 * accessors.
 *
 * overdeck.db stores INTEGER milliseconds; the domain types these modules
 * return predate that and use ISO strings. Both merge-sync.ts and
 * merge-sync-uat.ts need the conversion, and merge-sync.ts re-exports
 * merge-sync-uat.ts — so the helpers live here rather than in either module,
 * where the import would close a cycle.
 */

export function isoFromMillis(value: number | null | undefined): string | undefined {
  return value == null ? undefined : new Date(value).toISOString();
}

export function isoFromMillisRequired(value: number): string {
  return new Date(value).toISOString();
}

export function millisFromIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function nowMillis(): number {
  return Date.now();
}
