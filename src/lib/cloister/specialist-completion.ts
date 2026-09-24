/**
 * Event-Driven Specialist Completion (PAN-632)
 *
 * Replaces polling loops with Effect-based completion.
 * When a specialist finishes, it calls /api/specialists/done which
 * calls reportSpecialistCompletion() to resolve the pending Effect.
 */

import { Data, Effect } from 'effect';

// ─── Error types ──────────────────────────────────────────────────────────────

class SpecialistCompletionTimeoutError extends Data.TaggedError('SpecialistCompletionTimeoutError')<{
  readonly issueId: string;
  readonly timeoutMs: number;
}> {}

class SpecialistSupersededError extends Data.TaggedError('SpecialistSupersededError')<{
  readonly issueId: string;
}> {}

class SpecialistCancelledError extends Data.TaggedError('SpecialistCancelledError')<{
  readonly issueId: string;
  readonly reason: string;
}> {}

export type SpecialistCompletionError =
  | SpecialistCompletionTimeoutError
  | SpecialistSupersededError
  | SpecialistCancelledError;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpecialistCompletionResult {
  status: 'passed' | 'failed';
  notes?: string;
}

type ResumeCallback = (effect: Effect.Effect<SpecialistCompletionResult, SpecialistCompletionError>) => void;

interface PendingCompletion {
  resume: ResumeCallback;
  timer: ReturnType<typeof setTimeout>;
}

const _pendingCompletions = new Map<string, PendingCompletion>();

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Report that a specialist has completed its task for an issue.
 * Called from /api/specialists/done handler.
 * Returns true if there was a pending waiter (Effect resolved).
 */
export function reportSpecialistCompletion(
  issueId: string,
  result: SpecialistCompletionResult,
): Effect.Effect<boolean> {
  return Effect.sync(() => {
    const key = issueId.toUpperCase();
    const pending = _pendingCompletions.get(key);
    if (!pending) return false;

    clearTimeout(pending.timer);
    _pendingCompletions.delete(key);
    pending.resume(Effect.succeed(result));
    return true;
  });
}
