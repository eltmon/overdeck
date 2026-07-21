/**
 * In-flight guard — a per-key re-entrancy lock for fire-and-forget async tasks.
 *
 * This is the structural protection behind the postMergeLifecycle idempotency
 * invariant (PAN-328): the loop
 *   specialists/done → onMergeComplete → postMergeLifecycle → (re-trigger) → specialists/done
 * once burned 24,626 tracker API calls. The guard ensures a task for a given
 * key cannot run concurrently with itself — a second call while the first is
 * in flight is skipped, not queued.
 *
 * Lives in its own module (instead of an inline `Set` in the route handler) so
 * the invariant is enforced by `in-flight-guard.test.ts`, not by a comment
 * begging future agents not to delete it.
 */
export interface InFlightGuard {
  /**
   * Start `task` for `key` unless one is already in flight for that key.
   * Returns `true` if the task was started, `false` if it was skipped because
   * a prior run is still in flight. The key is released when `task` settles
   * (resolve or reject), so a later call runs again — this guards against
   * *concurrent* re-entry, not against ever running twice.
   */
  run(key: string, task: () => Promise<void>, onError?: (err: unknown) => void): boolean;
  /** True while a task for `key` is in flight. */
  isInFlight(key: string): boolean;
}

/**
 * Per-key promise coalescer — the awaited sibling of {@link createInFlightGuard}.
 * While a task for `key` is in flight, later callers receive the SAME promise
 * instead of starting a second run. PAN-2695: two review dispatches 225ms apart
 * raced fresh-spawn vs resume — the second saw the first's milliseconds-old
 * agent state, "resumed" a parent session that was still booting, and killed it
 * with the synthesis kickoff undelivered.
 */
export interface PromiseCoalescer<T> {
  /** Run `task` for `key`, or return the promise of the run already in flight. */
  run(key: string, task: () => Promise<T>): Promise<T>;
  /** True while a task for `key` is in flight. */
  isInFlight(key: string): boolean;
}

export function createPromiseCoalescer<T>(): PromiseCoalescer<T> {
  const inFlight = new Map<string, Promise<T>>();
  return {
    run(key, task) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const p = task();
      inFlight.set(key, p);
      p.catch(() => {}).finally(() => inFlight.delete(key));
      return p;
    },
    isInFlight(key) {
      return inFlight.has(key);
    },
  };
}

export function createInFlightGuard(): InFlightGuard {
  const inFlight = new Set<string>();
  return {
    run(key, task, onError) {
      if (inFlight.has(key)) return false;
      inFlight.add(key);
      void (async () => {
        try {
          await task();
        } catch (err) {
          onError?.(err);
        } finally {
          inFlight.delete(key);
        }
      })();
      return true;
    },
    isInFlight(key) {
      return inFlight.has(key);
    },
  };
}
