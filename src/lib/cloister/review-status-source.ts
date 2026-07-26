/**
 * PAN-2579: synchronous access to the review-status map for warm-idle advancing
 * classification in concurrency.ts, WITHOUT importing review-status-sync.ts —
 * that module transitively reaches agents/spawn.ts -> concurrency.ts
 * (review-status-sync -> review-status-normalize -> review-status -> agents),
 * so a direct concurrency.ts import closes a real cycle (caught by
 * scripts/lint-circular-deps.sh). Same shape as memory-verdict-cache.ts: this
 * module has no imports of its own, so it cannot be part of any cycle.
 *
 * review-status.ts registers both the raw map reader and the journal-reconciled
 * canonical resolver at module load. Raw-map callers get null when unavailable;
 * canonical callers receive available=false so safety gates can fail closed.
 */

/** Minimal status shape needed for advancing-session lifecycle classification. */
export interface WarmIdleStatusShape {
  reviewStatus?: string;
  testStatus?: string;
  readyForMerge?: boolean;
  mergeStatus?: string;
  mergeStep?: string;
}

export type AdvancingRole = 'review' | 'test' | 'ship';
export type AdvancingSessionLifecycle = 'active' | 'warm' | 'orphaned' | 'unknown';

const TERMINAL_REVIEW: ReadonlySet<string> = new Set(['passed', 'failed', 'blocked']);
const TERMINAL_TEST: ReadonlySet<string> = new Set(['passed', 'failed']);

export function isRoleTerminal(
  role: AdvancingRole,
  status: WarmIdleStatusShape,
): boolean {
  switch (role) {
    case 'review':
      return TERMINAL_REVIEW.has(status.reviewStatus ?? '');
    case 'test':
      return TERMINAL_TEST.has(status.testStatus ?? '');
    case 'ship':
      return status.readyForMerge === true
        || status.mergeStatus === 'merged'
        || status.mergeStatus === 'failed';
  }
}

export function classifyAdvancingSessionLifecycle(
  role: AdvancingRole,
  status: WarmIdleStatusShape | null | undefined,
  tmuxActive: boolean,
): AdvancingSessionLifecycle {
  if (!status || !tmuxActive) return 'unknown';
  if (status.mergeStatus === 'merged') return 'orphaned';
  return isRoleTerminal(role, status) ? 'warm' : 'active';
}

export function isAdvancingLifecycleReclaimable(
  lifecycle: AdvancingSessionLifecycle,
): boolean {
  return lifecycle === 'orphaned';
}

type StatusMapReader = () => Record<string, WarmIdleStatusShape>;
type CanonicalStatusResolver = (issueId: string) => WarmIdleStatusShape | null;

let reader: StatusMapReader | null = null;
let canonicalResolver: CanonicalStatusResolver | null = null;

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

export function registerCanonicalReviewStatusResolver(fn: CanonicalStatusResolver): void {
  canonicalResolver = fn;
}

export function resolveCanonicalReviewStatus(issueId: string): {
  available: boolean;
  status: WarmIdleStatusShape | null;
} {
  if (!canonicalResolver) return { available: false, status: null };
  try {
    return { available: true, status: canonicalResolver(issueId) };
  } catch {
    return { available: false, status: null };
  }
}
