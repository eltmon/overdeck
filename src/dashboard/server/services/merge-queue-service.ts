import { getAllActiveQueues } from '../../../lib/overdeck/merge-sync.js';

/** Advance one project's merge queue — drop entries that cannot start, trigger the first that can. */
export type MergeQueueAdvanceHandler = (projectKey: string) => void;

let mergeQueueAdvanceHandler: MergeQueueAdvanceHandler | null = null;

export function setMergeQueueAdvanceHandler(handler: MergeQueueAdvanceHandler): void {
  mergeQueueAdvanceHandler = handler;
}

// ─── Merge-run progress (PAN-3917 W6) ────────────────────────────────────────
//
// The dashboard renders a live step tracker while the server merges an issue:
// which phase the run is in, which step it reached, and the note explaining a
// failure. That is the progress of an operation THIS process is running — not a
// pipeline status, and not derivable from the forge, which only ever shows the
// before and after. It is therefore kept in memory here and dies with the
// process, exactly like the pending-operations map. Whether the issue is ready,
// reviewed, or merged is never read from here: that comes from
// `services/derived-issue-state.ts`.
//
// This replaces the merge status, step, and notes fields the merge routes used
// to write onto the review-status record.

export type MergeRunPhase = 'queued' | 'merging' | 'verifying' | 'merged' | 'failed';

export interface MergeRun {
  readonly issueId: string;
  readonly phase: MergeRunPhase;
  /** Fine-grained step inside the phase (`rebasing`, `squash-merging`, …). */
  readonly step?: string;
  /** Operator-facing explanation, usually of a failure. */
  readonly notes?: string;
  readonly updatedAt: string;
}

/** A partial update to the run. `notes: null` clears the note. */
export interface MergeRunPatch {
  phase?: MergeRunPhase;
  step?: string;
  notes?: string | null;
}

const mergeRuns = new Map<string, MergeRun>();

/** Record progress for an in-flight merge run. Nothing is written to disk. */
export function setMergeRun(issueId: string, patch: MergeRunPatch): MergeRun {
  const key = issueId.toUpperCase();
  const previous = mergeRuns.get(key);
  const next: MergeRun = {
    issueId: key,
    phase: patch.phase ?? previous?.phase ?? 'merging',
    updatedAt: new Date().toISOString(),
    ...(patch.step !== undefined ? { step: patch.step } : previous?.step !== undefined ? { step: previous.step } : {}),
    ...(patch.notes === null ? {} : patch.notes !== undefined ? { notes: patch.notes } : previous?.notes !== undefined ? { notes: previous.notes } : {}),
  };
  mergeRuns.set(key, next);
  return next;
}

export function getMergeRun(issueId: string): MergeRun | null {
  return mergeRuns.get(issueId.toUpperCase()) ?? null;
}

export function listMergeRuns(): MergeRun[] {
  return [...mergeRuns.values()];
}

export function clearMergeRun(issueId: string): void {
  mergeRuns.delete(issueId.toUpperCase());
}

/** Test seam: drop every recorded run. */
export function _resetMergeRunsForTests(): void {
  mergeRuns.clear();
}

/**
 * Boot recovery: restart every project queue that holds entries with nothing processing.
 *
 * PAN-3328: this used to hand `queue[0]` straight to `triggerMerge()`, which rejects an
 * issue whose PR is not approved-green-mergeable before it ever touches the queue. A dead
 * head therefore bounced on every boot and the queue never advanced past it. Going through
 * the shared advance drops those heads instead of stopping on them.
 */
export async function resumeQueuedMerges(): Promise<void> {
  if (!mergeQueueAdvanceHandler) {
    console.warn('[overdeck] Merge queue resume skipped: advance handler not registered');
    return;
  }

  for (const queue of getAllActiveQueues()) {
    if (queue.current || queue.queue.length === 0) continue;
    console.log(`[overdeck] Resuming merge queue for ${queue.projectKey} (${queue.queue.length} queued)`);
    mergeQueueAdvanceHandler(queue.projectKey);
  }
}
