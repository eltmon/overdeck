/**
 * Verdict artifact recovery observation (PAN-3511).
 *
 * Workspace artifacts are evidence from a host-recorded active review run. A
 * recovery path may converge that evidence only through recordReviewVerdict(),
 * which owns the terminal pipeline-state write and its head protections.
 */
import { emitActivityEntryOnce, type ActivityEmitOutcome, type EmitActivityOptions } from '../activity-logger.js';
import { rehydrateHeadAnchor, snapshotWorkspaceHeadsPromise } from '../git-utils.js';
import { getCloisterEventStore } from './event-store-provider.js';
import { recordReviewVerdict, type VerdictOutcome, type VerdictWriter } from './review-verdict-writer.js';
import {
  readLatestSynthesisVerdictAsync,
  SYNTHESIS_ARTIFACT_FRESH_MS,
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

export interface VerdictOfRecordConvergenceOptions {
  /** Host-recorded active review run; no run ID means no artifact is eligible. */
  runId?: string;
  workspacePath: string;
  writer: VerdictWriter;
  /** Caller attribution that augments the artifact's report-derived notes. */
  notes?: string;
  deps?: Partial<VerdictOfRecordConvergenceDeps>;
}

export interface VerdictOfRecordConvergenceDeps {
  readArtifact(issueId: string, options: { runId?: string; workspacePath?: string }): Promise<SynthesisArtifactVerdict | null>;
  snapshotWorkspaceHeads(issueId: string, workspacePath: string): Promise<string | undefined>;
  recordVerdict(issueId: string, input: Parameters<typeof recordReviewVerdict>[1]): Promise<VerdictOutcome>;
}

export type VerdictOfRecordConvergenceResult =
  | { converged: false }
  | { converged: true; artifact: SynthesisArtifactVerdict; outcome: VerdictOutcome & { landed: true } };

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

const DEFAULT_CONVERGENCE_DEPS: VerdictOfRecordConvergenceDeps = {
  readArtifact: (issueId, options) => readLatestSynthesisVerdictAsync(issueId, options),
  snapshotWorkspaceHeads: snapshotWorkspaceHeadsPromise,
  recordVerdict: recordReviewVerdict,
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
 * Converge a pending review dispatch from a fresh artifact owned by the
 * host-recorded active review run. The artifact must name the current workspace
 * head, then the verdict write door decides whether the terminal state can land.
 */
export async function convergeRowFromVerdictOfRecord(
  issueId: string,
  options: VerdictOfRecordConvergenceOptions,
): Promise<VerdictOfRecordConvergenceResult> {
  if (!options.runId) return { converged: false };

  const deps = { ...DEFAULT_CONVERGENCE_DEPS, ...options.deps };
  const artifact = await deps.readArtifact(issueId, {
    runId: options.runId,
    workspacePath: options.workspacePath,
  });
  if (
    !artifact
    || !artifact.headSha
    || Date.now() - artifact.mtimeMs > SYNTHESIS_ARTIFACT_FRESH_MS
  ) return { converged: false };

  const workspaceHead = await deps.snapshotWorkspaceHeads(issueId, options.workspacePath);
  if (!workspaceHead || artifact.headSha !== workspaceHead) return { converged: false };

  const outcome = await deps.recordVerdict(issueId, {
    verdict: artifact.verdict,
    notes: options.notes ?? artifact.notes,
    evidenceHead: rehydrateHeadAnchor(artifact.headSha),
    runId: artifact.runId,
    writer: options.writer,
  });
  return outcome.landed
    ? { converged: true, artifact, outcome }
    : { converged: false };
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
