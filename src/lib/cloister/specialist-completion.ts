/**
 * Event-Driven Specialist Completion (PAN-632)
 *
 * Replaces polling loops with Promise-based completion.
 * When a specialist finishes, it calls /api/specialists/done which
 * calls reportSpecialistCompletion() to resolve the pending Promise.
 */

export interface SpecialistCompletionResult {
  status: 'passed' | 'failed';
  notes?: string;
}

interface PendingCompletion {
  resolve: (result: SpecialistCompletionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const _pendingCompletions = new Map<string, PendingCompletion>();

/**
 * Wait for a specialist to complete its task for a given issue.
 * Returns a Promise that resolves when /api/specialists/done is called
 * for this issue, or rejects on timeout.
 *
 * Used by spawnMergeAgentForBranches and syncMainIntoWorkspace
 * to replace their 5s polling loops.
 */
export function waitForSpecialistCompletion(
  issueId: string,
  timeoutMs: number = 15 * 60 * 1000,
): Promise<SpecialistCompletionResult> {
  const key = issueId.toUpperCase();

  // If there's already a pending waiter for this issue, reject it first
  const existing = _pendingCompletions.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.reject(new Error(`Superseded by new waiter for ${key}`));
    _pendingCompletions.delete(key);
  }

  return new Promise<SpecialistCompletionResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      _pendingCompletions.delete(key);
      reject(new Error(`Specialist completion timed out after ${Math.round(timeoutMs / 1000)}s for ${key}`));
    }, timeoutMs);

    _pendingCompletions.set(key, { resolve, reject, timer });
  });
}

/**
 * Report that a specialist has completed its task for an issue.
 * Called from /api/specialists/done handler.
 * Returns true if there was a pending waiter (Promise resolved).
 */
export function reportSpecialistCompletion(
  issueId: string,
  result: SpecialistCompletionResult,
): boolean {
  const key = issueId.toUpperCase();
  const pending = _pendingCompletions.get(key);
  if (!pending) return false;

  clearTimeout(pending.timer);
  _pendingCompletions.delete(key);
  pending.resolve(result);
  return true;
}

/**
 * Check if there's a pending waiter for an issue.
 */
export function hasPendingCompletion(issueId: string): boolean {
  return _pendingCompletions.has(issueId.toUpperCase());
}

/**
 * Cancel all pending completions (e.g., on server shutdown).
 */
export function cancelAllPendingCompletions(): void {
  for (const [key, pending] of _pendingCompletions) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Server shutting down'));
  }
  _pendingCompletions.clear();
}
