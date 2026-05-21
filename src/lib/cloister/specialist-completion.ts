/**
 * Event-Driven Specialist Completion (PAN-632)
 *
 * Replaces polling loops with Effect-based completion.
 * When a specialist finishes, it calls /api/specialists/done which
 * calls reportSpecialistCompletion() to resolve the pending Effect.
 */

import { Data, Effect } from 'effect';

// ─── Error types ──────────────────────────────────────────────────────────────

export class SpecialistCompletionTimeoutError extends Data.TaggedError('SpecialistCompletionTimeoutError')<{
  readonly issueId: string;
  readonly timeoutMs: number;
}> {}

export class SpecialistSupersededError extends Data.TaggedError('SpecialistSupersededError')<{
  readonly issueId: string;
}> {}

export class SpecialistCancelledError extends Data.TaggedError('SpecialistCancelledError')<{
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
 * Wait for a specialist to complete its task for a given issue.
 * Returns an Effect that succeeds when /api/specialists/done is called
 * for this issue, or fails with a typed error on timeout or supersession.
 *
 * Used by spawnMergeAgentForBranches and syncMainIntoWorkspace
 * to replace their 5s polling loops.
 */
export function waitForSpecialistCompletion(
  issueId: string,
  timeoutMs: number = 15 * 60 * 1000,
): Effect.Effect<SpecialistCompletionResult, SpecialistCompletionError> {
  return Effect.callback<SpecialistCompletionResult, SpecialistCompletionError>((resume) => {
    const key = issueId.toUpperCase();

    // Supersede any existing waiter for this issue
    const existing = _pendingCompletions.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resume(Effect.fail(new SpecialistSupersededError({ issueId: key })));
      _pendingCompletions.delete(key);
    }

    const timer = setTimeout(() => {
      _pendingCompletions.delete(key);
      resume(Effect.fail(new SpecialistCompletionTimeoutError({ issueId: key, timeoutMs })));
    }, timeoutMs);

    _pendingCompletions.set(key, { resume, timer });

    // Cleanup when fiber is interrupted
    return Effect.sync(() => {
      clearTimeout(timer);
      _pendingCompletions.delete(key);
    });
  });
}

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

/**
 * Check if there's a pending waiter for an issue.
 */
export function hasPendingCompletion(issueId: string): Effect.Effect<boolean> {
  return Effect.sync(() => _pendingCompletions.has(issueId.toUpperCase()));
}

/**
 * Cancel all pending completions (e.g., on server shutdown).
 */
export function cancelAllPendingCompletions(): Effect.Effect<void> {
  return Effect.sync(() => {
    for (const [key, pending] of _pendingCompletions) {
      clearTimeout(pending.timer);
      pending.resume(Effect.fail(new SpecialistCancelledError({ issueId: key, reason: 'Server shutting down' })));
    }
    _pendingCompletions.clear();
  });
}
