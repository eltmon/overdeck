/**
 * Bounded parallelism work pool (PAN-457).
 *
 * Limits concurrent async tasks to maxParallel. Tasks are started as soon as a
 * slot is free — no batching. Uses Effect.all concurrency for back-pressure.
 */

import { Effect } from 'effect';

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
export function runWithPool<T>(
  tasks: Array<() => Promise<T>>,
  maxParallel: number,
  onDone?: (result: T | Error, index: number) => void,
): Effect.Effect<Array<T | Error>> {
  if (tasks.length === 0) return Effect.succeed([]);
  const limit = Math.max(1, maxParallel);

  const effects = tasks.map((task, idx) =>
    Effect.tryPromise({
      try: () => task(),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }).pipe(
      Effect.matchEffect({
        onFailure: (err) =>
          Effect.sync(() => {
            onDone?.(err, idx);
            return err as T | Error;
          }),
        onSuccess: (val) =>
          Effect.sync(() => {
            onDone?.(val, idx);
            return val as T | Error;
          }),
      }),
    ),
  );

  return Effect.all(effects, { concurrency: limit });
}
