/**
 * Verdict artifact recovery door (PAN-3511).
 *
 * A recovery path reads only the host-recorded active review run, predicts an
 * anchor mismatch before changing pipeline state, and delegates a safe terminal
 * write to `recordReviewVerdict()`. The helper never writes `review_status`
 * directly, so the canonical stale-evidence rejection remains authoritative.
 */
import { emitActivityEntryOnce, type ActivityEmitOutcome, type EmitActivityOptions } from '../activity-logger.js';
import { rehydrateHeadAnchor } from '../git-utils.js';
import { getCloisterEventStore } from './event-store-provider.js';
import {
  recordReviewVerdict,
  type VerdictOutcome,
} from './review-verdict-writer.js';
import {
  readLatestSynthesisVerdictAsync,
  type SynthesisArtifactVerdict,
} from './synthesis-verdict.js';

export type ArtifactVerdictRestoreOutcome = 'no-artifact' | 'blocked-by-head-guard' | 'restored';

export type ArtifactVerdictRestoreResult =
  | { outcome: 'no-artifact' }
  | { outcome: 'blocked-by-head-guard'; artifact: SynthesisArtifactVerdict }
  | { outcome: 'restored'; artifact: SynthesisArtifactVerdict };

export interface ArtifactVerdictRestoreOptions {
  /** Host-recorded active review run; no run ID means no artifact is eligible. */
  runId?: string;
  workspacePath?: string;
  /** Current review-row anchor used to preserve a mismatched artifact for diagnosis. */
  rowHead?: string;
  /** Clear only this caller-owned stuck flag after a terminal verdict lands. */
  clearStuckReason?: string;
  /** Recovery path attempting the restore, included in the diagnostic event. */
  caller?: string;
  deps?: Partial<ArtifactVerdictRestoreDeps>;
}

export interface ArtifactVerdictRestoreDeps {
  readArtifact(issueId: string, options: { runId?: string; workspacePath?: string }): Promise<SynthesisArtifactVerdict | null>;
  recordVerdict(issueId: string, input: Parameters<typeof recordReviewVerdict>[1]): Promise<VerdictOutcome>;
  emitEvent(type: string, payload: Record<string, unknown>): void;
  emitActivity(options: EmitActivityOptions & { id: string }): Promise<ActivityEmitOutcome>;
}

/**
 * Predict the strict anchor guard used for recovery. The writer can classify
 * differing heads as fresh, but a recovery artifact must preserve every
 * mismatch for an operator instead of overwriting a live review cycle.
 */
export function restoreWouldTripHeadGuard(input: {
  artifactHead?: string;
  rowHead?: string;
}): boolean {
  return !!input.artifactHead && !!input.rowHead && input.artifactHead !== input.rowHead;
}

function defaultEmitEvent(type: string, payload: Record<string, unknown>): void {
  try {
    getCloisterEventStore()?.append({
      type,
      timestamp: new Date().toISOString(),
      payload,
    } as Parameters<NonNullable<ReturnType<typeof getCloisterEventStore>>['append']>[0]);
  } catch (error) {
    console.warn(`[verdict-restore] failed to append ${type}:`, error instanceof Error ? error.message : String(error));
  }
}

const DEFAULT_DEPS: ArtifactVerdictRestoreDeps = {
  readArtifact: (issueId, options) => readLatestSynthesisVerdictAsync(issueId, options),
  recordVerdict: recordReviewVerdict,
  emitEvent: defaultEmitEvent,
  emitActivity: (options) => emitActivityEntryOnce(options),
};

async function reportBlockedRestore(
  issueId: string,
  artifact: SynthesisArtifactVerdict,
  rowHead: string | undefined,
  caller: string,
  reason: string,
  deps: ArtifactVerdictRestoreDeps,
): Promise<void> {
  deps.emitEvent('review.verdict_restore_blocked', {
    issueId,
    caller,
    verdict: artifact.verdict,
    artifactHead: artifact.headSha,
    rowHead,
    reason,
  });
  await deps.emitActivity({
    id: `verdict-restore-blocked:${issueId}:${artifact.headSha ?? 'none'}:${rowHead ?? 'none'}:${reason}`,
    source: 'cloister',
    level: 'warn',
    issueId,
    message: `[verdict-restore] ${issueId}: a fresh ${artifact.verdict.toUpperCase()} artifact from run ${artifact.runId} was preserved instead of restored (${reason}).`,
  });
}

/**
 * Read the active-run artifact asynchronously without mutating review status.
 * Feedback and observability callers use this when they only need evidence.
 */
export function readActiveReviewArtifactAsync(
  issueId: string,
  options: Pick<ArtifactVerdictRestoreOptions, 'runId' | 'workspacePath'>,
): Promise<SynthesisArtifactVerdict | null> {
  if (!options.runId) return Promise.resolve(null);
  return readLatestSynthesisVerdictAsync(issueId, options);
}

/**
 * Restore a terminal artifact verdict through the canonical writer. `no-artifact`
 * preserves the caller's legacy reset/mark behavior. A guard-refused artifact is
 * visible through `review.verdict_restore_blocked` and must not be reset over.
 */
export async function attemptArtifactVerdictRestore(
  issueId: string,
  options: ArtifactVerdictRestoreOptions,
): Promise<ArtifactVerdictRestoreResult> {
  const deps = { ...DEFAULT_DEPS, ...options.deps };
  if (!options.runId) return { outcome: 'no-artifact' };
  const artifact = await deps.readArtifact(issueId, {
    runId: options.runId,
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
  });
  if (!artifact) return { outcome: 'no-artifact' };

  const caller = options.caller ?? 'unknown';
  if (restoreWouldTripHeadGuard({ artifactHead: artifact.headSha, rowHead: options.rowHead })) {
    await reportBlockedRestore(issueId, artifact, options.rowHead, caller, 'artifact-head-mismatch', deps);
    return { outcome: 'blocked-by-head-guard', artifact };
  }

  const outcome = await deps.recordVerdict(issueId, {
    verdict: artifact.verdict,
    ...(artifact.notes ? { notes: artifact.notes } : {}),
    ...(artifact.headSha ? { evidenceHead: rehydrateHeadAnchor(artifact.headSha) } : {}),
    extra: {
      reviewRetryCount: 0,
      recoveryStartedAt: undefined,
    },
    ...(options.clearStuckReason ? { clearStuckReason: options.clearStuckReason } : {}),
    runId: artifact.runId,
    writer: 'orphan-restore',
  });
  if (!outcome.landed) {
    await reportBlockedRestore(issueId, artifact, options.rowHead, caller, outcome.reason, deps);
    return { outcome: 'blocked-by-head-guard', artifact };
  }

  return { outcome: 'restored', artifact };
}
