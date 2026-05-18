/**
 * Bounded parallelism work pool (PAN-457).
 *
 * Limits concurrent async tasks to maxParallel. Tasks are started as soon as a
 * slot is free — no batching. Uses promise chaining to avoid setTimeout polling.
 */

export interface WorkPoolStats {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
}

/**
 * Run all tasks with bounded concurrency.
 *
 * @param tasks     Array of async functions to execute
 * @param maxParallel  Maximum concurrent executions
 * @param onDone    Optional callback called after each task completes (success or failure)
 */
export async function runWithPool<T>(
  tasks: Array<() => Promise<T>>,
  maxParallel: number,
  onDone?: (result: T | Error, index: number) => void,
): Promise<Array<T | Error>> {
  if (tasks.length === 0) return [];
  const limit = Math.max(1, maxParallel);

  const results: Array<T | Error> = new Array(tasks.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      const task = tasks[idx];
      try {
        const result = await task();
        results[idx] = result;
        onDone?.(result, idx);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        results[idx] = error;
        onDone?.(error, idx);
      }
    }
  }

  // Spawn `limit` workers and wait for all to drain
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
