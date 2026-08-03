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
import { getReviewStatusSync, setReviewStatusSync, type ReviewStatusUpdate } from '../review-status.js';
import type { ReviewStatus } from '../review-status-reconcile.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { readLatestSynthesisVerdict, type SynthesisArtifactVerdict } from './synthesis-verdict.js';

export type ArtifactVerdictRestoreOutcome = 'no-artifact' | 'blocked-by-head-guard' | 'restored';

export type ArtifactVerdictRestoreResult =
  | { outcome: 'no-artifact' }
  | { outcome: 'blocked-by-head-guard'; artifact: SynthesisArtifactVerdict }
  | { outcome: 'restored'; artifact: SynthesisArtifactVerdict };

/** Injection seam — every dependency a fixture needs to drive this without touching disk. */
export interface ArtifactVerdictRestoreDeps {
  readArtifact(
    issueId: string,
    options: { now?: number; workspacePath?: string },
  ): SynthesisArtifactVerdict | null;
  getStatus(issueId: string): ReviewStatus | null;
  setStatus(issueId: string, update: ReviewStatusUpdate): void;
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
  deps?: Partial<ArtifactVerdictRestoreDeps>;
}

/**
 * Would writing this artifact's verdict be rejected for disagreeing with the
 * row's anchor? True only when BOTH heads are present and differ — an artifact
 * with no head evidence (the common quick-self-review shape, which carries no
 * context.json) cannot trip it, and neither can a row that has never recorded a
 * verified commit.
 */
export function restoreWouldTripHeadGuard(input: {
  artifactHead?: string | undefined;
  lastVerifiedCommit?: string | undefined;
}): boolean {
  const artifactHead = input.artifactHead;
  const rowHead = input.lastVerifiedCommit;
  if (typeof artifactHead !== 'string' || artifactHead.length === 0) return false;
  if (typeof rowHead !== 'string' || rowHead.length === 0) return false;
  return artifactHead !== rowHead;
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

const DEFAULT_DEPS: ArtifactVerdictRestoreDeps = {
  readArtifact: readLatestSynthesisVerdict,
  getStatus: getReviewStatusSync,
  setStatus: (issueId, update) => { setReviewStatusSync(issueId, update); },
  emitEvent: defaultEmitEvent,
  emitActivity: emitActivityEntryOnce,
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
  options: ArtifactVerdictRestoreOptions = {},
): Promise<ArtifactVerdictRestoreResult> {
  const deps: ArtifactVerdictRestoreDeps = { ...DEFAULT_DEPS, ...options.deps };

  const artifact = deps.readArtifact(issueId, {
    now: deps.now(),
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
  });
  // An absent artifact is "no evidence", never "approve" — the caller keeps its
  // existing behavior untouched.
  if (!artifact) return { outcome: 'no-artifact' };

  const status = deps.getStatus(issueId);

  if (restoreWouldTripHeadGuard({
    artifactHead: artifact.headSha,
    lastVerifiedCommit: status?.lastVerifiedCommit,
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

  const update: ReviewStatusUpdate = {
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
