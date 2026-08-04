/**
 * The verdict-of-record restore door (PAN-3511).
 *
 * Recovery machinery mutates the review_status row from several independent
 * directions — the deacon orphan reset, the feedback-target and
 * review-infrastructure stuck-marking paths, the stall sweeper's stuck
 * re-drive, and the advancing-journal reconcile — and each historically read
 * different evidence at a different lag. None consulted the one durable
 * verdict of record: the reviewer's own artifact (`.pan/review/<run>/synthesis.md`
 * for a convoy, `review.md` for a quick self-review). A reviewer writes that
 * artifact seconds to minutes BEFORE its verdict syncs into the row, so any
 * recovery firing inside that window saw a dead-looking review and wiped an
 * APPROVED verdict to pending. PAN-1577 lost five passed reviews to this in one
 * evening (2026-08-02).
 *
 * This module is the single read-side decision point those paths call before
 * they mark, reset, or re-drive a row. It never invents approval: an absent
 * artifact means "no evidence", not "approve", and every caller keeps its exact
 * prior behavior on the `no-artifact` outcome.
 *
 * ── Why the head guard is PREDICTED rather than delegated ────────────────────
 *
 * A restore writes through `setReviewStatusSync`, which does NOT run the
 * evidence-head classification that the verdict write door
 * (`review-verdict-writer.ts:151-213`) applies to a reviewer's own signal. So
 * this module predicts the rejection itself, in `restoreWouldTripHeadGuard`,
 * and declines to write when the artifact's head disagrees with the row's
 * anchor.
 *
 * The prediction is deliberately CONSERVATIVE: it blocks whenever both heads
 * are present and differ, where the write door would additionally classify a
 * differing head as fresh/indeterminate and land it. That asymmetry is the
 * intended split — making the loss VISIBLE is this issue, making a
 * differing-head verdict LAND is PAN-3512's write door. Restoring here must
 * never take the two loopholes the guard exists to close: dropping
 * `reviewedAtCommit` to sneak an unanchored terminal verdict past it, or
 * re-anchoring to the row's own `lastVerifiedCommit`, which lies about what the
 * reviewer actually read and corrupts the next cycle's re-run logic.
 *
 * The prediction is one exported pure function so that a future change to the
 * guard's predicate has exactly one place to land.
 */
import { rehydrateHeadAnchor } from '../git-utils.js';
import { emitActivityEntryOnce, type ActivityEmitOutcome, type EmitActivityOptions } from '../activity-logger.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { restoreWouldTripHeadGuard } from './verdict-head-guard.js';
import {
  readMemoizedArtifactVerdict,
  type SynthesisArtifactReadOptions,
  type SynthesisArtifactVerdict,
} from './synthesis-verdict.js';

/**
 * The row fields this door reads, and the update it writes, declared
 * structurally on purpose. `review-status.ts` reaches up into
 * `cloister/feedback-target.ts`, which now calls this door — so importing the
 * review-status types or accessors here would close an import cycle that Node's
 * strict ESM rejects at runtime. Callers supply the accessors from their own
 * review-status import instead, which also states the honest contract: this
 * module is a decision function over injected state access, not a store client.
 */
export interface VerdictRestoreRow {
  lastVerifiedCommit?: string | undefined;
  stuckReason?: string | undefined;
}

export interface VerdictRestoreUpdate {
  reviewStatus: SynthesisArtifactVerdict['verdict'];
  reviewNotes: string | undefined;
  reviewRetryCount: number;
  recoveryStartedAt: undefined;
  // Branded HeadAnchor, sourced from git-utils — which is outside the cycle, so
  // the door can still be precise about the one anchor it writes.
  reviewedAtCommit?: ReturnType<typeof rehydrateHeadAnchor>;
  stuck?: boolean;
  stuckReason?: undefined;
  stuckAt?: undefined;
  stuckDetails?: undefined;
}

export type ArtifactVerdictRestoreOutcome = 'no-artifact' | 'blocked-by-head-guard' | 'restored';

export type ArtifactVerdictRestoreResult =
  | { outcome: 'no-artifact' }
  | { outcome: 'blocked-by-head-guard'; artifact: SynthesisArtifactVerdict }
  | { outcome: 'restored'; artifact: SynthesisArtifactVerdict };

/** Injection seam — every dependency a fixture needs to drive this without touching disk. */
export interface ArtifactVerdictRestoreDeps {
  readArtifact(
    issueId: string,
    options: SynthesisArtifactReadOptions,
  ): SynthesisArtifactVerdict | null;
  getStatus(issueId: string): VerdictRestoreRow | null;
  setStatus(issueId: string, update: VerdictRestoreUpdate): void;
  emitEvent(type: string, payload: Record<string, unknown>): void;
  emitActivity(options: EmitActivityOptions & { id: string }): Promise<ActivityEmitOutcome>;
  now(): number;
}

export interface ArtifactVerdictRestoreOptions {
  /**
   * Clear the stuck flags only when the row is stuck for THIS reason. A caller
   * clears the gate it owns; it must not silently clear an unrelated one.
   */
  clearStuckReason?: string;
  /** Recovery path attempting the restore — recorded on the blocked event. */
  caller?: string;
  workspacePath?: string;
  /** Test/recovery injection for the active host-recorded run provenance. */
  reviewRunId?: string;
  reviewArtifactCapability?: string;
  /** Reuse a caller-selected immutable snapshot instead of re-reading the filesystem. */
  selectedArtifact?: SynthesisArtifactVerdict;
  /** getStatus/setStatus are required — see VerdictRestoreRow for why. */
  deps: Pick<ArtifactVerdictRestoreDeps, 'getStatus' | 'setStatus'>
  & Partial<Omit<ArtifactVerdictRestoreDeps, 'getStatus' | 'setStatus'>>;
}

function defaultEmitEvent(type: string, payload: Record<string, unknown>): void {
  try {
    getCloisterEventStore()?.append({
      type,
      timestamp: new Date().toISOString(),
      payload,
    } as Parameters<NonNullable<ReturnType<typeof getCloisterEventStore>>['append']>[0]);
  } catch (error) {
    console.warn(
      `[verdict-restore] failed to append ${type}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

const DEFAULT_DEPS: Omit<ArtifactVerdictRestoreDeps, 'getStatus' | 'setStatus'> = {
  readArtifact: readMemoizedArtifactVerdict,
  emitEvent: defaultEmitEvent,
  // Called through rather than bound, so importing this module does not force
  // every transitive importer's test to mock an export only the blocked path uses.
  emitActivity: (options) => emitActivityEntryOnce(options),
  now: () => Date.now(),
};

/**
 * Consult the verdict artifact of record and restore it onto the row when it is
 * safe to do so. Returns what happened so the caller can decide whether to
 * proceed with its own reset / stuck-marking / re-drive.
 *
 * Writes NOTHING on `no-artifact` and `blocked-by-head-guard`.
 */
export async function attemptArtifactVerdictRestore(
  issueId: string,
  options: ArtifactVerdictRestoreOptions,
): Promise<ArtifactVerdictRestoreResult> {
  const deps: ArtifactVerdictRestoreDeps = { ...DEFAULT_DEPS, ...options.deps };

  const artifact = options.selectedArtifact ?? deps.readArtifact(issueId, {
    now: deps.now(),
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
    ...(options.reviewRunId ? { reviewRunId: options.reviewRunId } : {}),
    ...(options.reviewArtifactCapability ? { reviewArtifactCapability: options.reviewArtifactCapability } : {}),
  });
  // An absent artifact is "no evidence", never "approve" — the caller keeps its
  // existing behavior untouched.
  if (!artifact) return { outcome: 'no-artifact' };

  const status = deps.getStatus(issueId);

  if (restoreWouldTripHeadGuard({
    artifactHead: artifact.headSha,
    rowHead: status?.lastVerifiedCommit,
  })) {
    const artifactHead = artifact.headSha as string;
    const rowHead = status?.lastVerifiedCommit as string;
    const caller = options.caller ?? 'unknown';

    deps.emitEvent('review.verdict_restore_blocked', {
      issueId,
      caller,
      verdict: artifact.verdict,
      artifactHead,
      rowHead,
      reason: 'artifact-head-mismatch',
    });

    // Once per condition, not once per patrol: these callers run on a ~60s
    // deacon patrol, and a persistently-blocked restore would otherwise turn
    // the operator's activity feed into a metronome. The id keys on the exact
    // condition, so a NEW artifact head or a moved row anchor reports again.
    await deps.emitActivity({
      id: `verdict-restore-blocked:${issueId}:${artifactHead}:${rowHead}`,
      source: 'cloister',
      level: 'warn',
      issueId,
      message:
        `[verdict-restore] ${issueId}: a fresh ${artifact.verdict.toUpperCase()} review artifact `
        + `(head ${artifactHead.slice(0, 8)}) was NOT restored — the row is anchored to `
        + `${rowHead.slice(0, 8)}, so writing it would be rejected as stale evidence. `
        + `The verdict is preserved on disk; PAN-3512's verdict write door is the path that lands it.`,
    });

    return { outcome: 'blocked-by-head-guard', artifact };
  }

  const update: VerdictRestoreUpdate = {
    reviewStatus: artifact.verdict,
    reviewNotes: artifact.notes,
    reviewRetryCount: 0,
    recoveryStartedAt: undefined,
    ...(artifact.headSha ? { reviewedAtCommit: rehydrateHeadAnchor(artifact.headSha) } : {}),
  };

  // Clear only the gate this caller owns, and only when the row is actually
  // held by it.
  if (options.clearStuckReason && status?.stuckReason === options.clearStuckReason) {
    update.stuck = false;
    update.stuckReason = undefined;
    update.stuckAt = undefined;
    update.stuckDetails = undefined;
  }

  deps.setStatus(issueId, update);
  return { outcome: 'restored', artifact };
}
