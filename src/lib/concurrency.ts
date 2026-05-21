import { Effect } from 'effect';

/**
 * Simple semaphore: run at most `max` effects concurrently.
 *
 * Each Promise-returning thunk is wrapped with `Effect.promise` so
 * unhandled rejections surface as defects, matching the original semantics.
 */
export function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  max: number,
): Effect.Effect<T[], never> {
  return Effect.forEach(tasks, (task) => Effect.promise(task), { concurrency: max });
}
