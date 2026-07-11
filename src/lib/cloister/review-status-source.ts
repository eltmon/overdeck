/**
 * PAN-2579: synchronous access to the review-status map for warm-idle advancing
 * classification in concurrency.ts, WITHOUT importing review-status-sync.ts —
 * that module transitively reaches agents/spawn.ts -> concurrency.ts
 * (review-status-sync -> review-status-normalize -> review-status -> agents),
 * so a direct concurrency.ts import closes a real cycle (caught by
 * scripts/lint-circular-deps.sh). Same shape as memory-verdict-cache.ts: this
 * module has no imports of its own, so it cannot be part of any cycle.
 *
 * review-status.ts registers the reader at module load. Before registration
 * (or if the read throws) callers get null and treat NOTHING as warm-idle —
 * the ceiling stays conservative.
 */

/** Minimal status shape needed for warm-idle classification (mirrors ReapableStatus). */
export interface WarmIdleStatusShape {
  reviewStatus?: string;
  testStatus?: string;
  readyForMerge?: boolean;
  mergeStatus?: string;
}

type StatusMapReader = () => Record<string, WarmIdleStatusShape>;

let reader: StatusMapReader | null = null;

export function registerReviewStatusMapReader(fn: StatusMapReader): void {
  reader = fn;
}

export function readReviewStatusMap(): Record<string, WarmIdleStatusShape> | null {
  if (!reader) return null;
  try {
    return reader();
  } catch {
    return null;
  }
}
