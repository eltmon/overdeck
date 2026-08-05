/**
 * Verdict artifact recovery observation (PAN-3511).
 *
 * Workspace artifacts are diagnostic evidence from a host-recorded active review
 * run. Recovery preserves and reports that evidence, but it never writes a
 * terminal verdict: a workspace-writable file cannot authorize pipeline state.
 */
import { emitActivityEntryOnce, type ActivityEmitOutcome, type EmitActivityOptions } from '../activity-logger.js';
import { getCloisterEventStore } from './event-store-provider.js';
import {
  readLatestSynthesisVerdictAsync,
  type SynthesisArtifactVerdict,
} from './synthesis-verdict.js';

export type ArtifactVerdictObservationOutcome = 'no-artifact' | 'observed' | 'blocked-by-head-guard';

export type ArtifactVerdictObservationResult =
  | { outcome: 'no-artifact' }
  | { outcome: 'observed'; artifact: SynthesisArtifactVerdict }
  | { outcome: 'blocked-by-head-guard'; artifact: SynthesisArtifactVerdict };

export interface ArtifactVerdictObservationOptions {
  /** Host-recorded active review run; no run ID means no artifact is eligible. */
  runId?: string;
  workspacePath?: string;
  /** Current review-row anchor used to flag conflicting evidence. */
  rowHead?: string;
  /** Recovery path inspecting evidence, included in diagnostic events. */
  caller?: string;
  deps?: Partial<ArtifactVerdictObservationDeps>;
}

export interface ArtifactVerdictObservationDeps {
  readArtifact(issueId: string, options: { runId?: string; workspacePath?: string }): Promise<SynthesisArtifactVerdict | null>;
  emitEvent(type: string, payload: Record<string, unknown>): void;
  emitActivity(options: EmitActivityOptions & { id: string }): Promise<ActivityEmitOutcome>;
}

/** Flag evidence whose recorded review head conflicts with the live row anchor. */
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

const DEFAULT_DEPS: ArtifactVerdictObservationDeps = {
  readArtifact: (issueId, options) => readLatestSynthesisVerdictAsync(issueId, options),
  emitEvent: defaultEmitEvent,
  emitActivity: (options) => emitActivityEntryOnce(options),
};

async function reportBlockedObservation(
  issueId: string,
  artifact: SynthesisArtifactVerdict,
  rowHead: string | undefined,
  caller: string,
  deps: ArtifactVerdictObservationDeps,
): Promise<void> {
  deps.emitEvent('review.verdict_restore_blocked', {
    issueId,
    caller,
    verdict: artifact.verdict,
    artifactHead: artifact.headSha,
    rowHead,
    reason: 'artifact-head-mismatch',
  });
  await deps.emitActivity({
    id: `verdict-restore-blocked:${issueId}:${artifact.headSha ?? 'none'}:${rowHead ?? 'none'}:artifact-head-mismatch`,
    source: 'cloister',
    level: 'warn',
    issueId,
    message: `[verdict-restore] ${issueId}: preserved a fresh ${artifact.verdict.toUpperCase()} artifact from run ${artifact.runId}; its evidence head conflicts with the current review cycle.`,
  });
}

/**
 * Read the active-run artifact asynchronously without mutating review status.
 * Feedback and observability callers use this when they only need evidence.
 */
export function readActiveReviewArtifactAsync(
  issueId: string,
  options: Pick<ArtifactVerdictObservationOptions, 'runId' | 'workspacePath'>,
): Promise<SynthesisArtifactVerdict | null> {
  if (!options.runId) return Promise.resolve(null);
  return readLatestSynthesisVerdictAsync(issueId, options);
}

/**
 * Preserve an active-run artifact as diagnostic evidence. A mismatch is visible
 * through `review.verdict_restore_blocked`; all outcomes leave terminal review
 * state to the canonical reviewer completion path.
 */
export async function observeActiveReviewArtifact(
  issueId: string,
  options: ArtifactVerdictObservationOptions,
): Promise<ArtifactVerdictObservationResult> {
  const deps = { ...DEFAULT_DEPS, ...options.deps };
  if (!options.runId) return { outcome: 'no-artifact' };
  const artifact = await deps.readArtifact(issueId, {
    runId: options.runId,
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
  });
  if (!artifact) return { outcome: 'no-artifact' };

  if (restoreWouldTripHeadGuard({ artifactHead: artifact.headSha, rowHead: options.rowHead })) {
    await reportBlockedObservation(issueId, artifact, options.rowHead, options.caller ?? 'unknown', deps);
    return { outcome: 'blocked-by-head-guard', artifact };
  }
  return { outcome: 'observed', artifact };
}
