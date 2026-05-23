import { Effect } from 'effect';function withConcurrencyLimitPromise<T>(
  tasks: Array<() => Promise<T>>,
  max: number,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results = new Array<T>(tasks.length);
    let index = 0;
    let running = 0;
    let completed = 0;
    let rejected = false;

    function next() {
      if (rejected) return;
      if (completed === tasks.length) {
        resolve(results);
        return;
      }
      while (running < max && index < tasks.length) {
        const i = index++;
        running++;
        tasks[i]!()
          .then((val) => {
            results[i] = val;
            running--;
            completed++;
            next();
          })
          .catch((err) => {
            rejected = true;
            reject(err);
          });
      }
    }

    next();
  });
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native semaphore: run at most `max` Effects concurrently, preserving
 * order. Mirrors withConcurrencyLimit but composes with Effect's typed error
 * channel via Effect.all + concurrency option.
 *
 * Use this for new Effect-flavored call-sites; existing Promise-based callers
 * keep using withConcurrencyLimit.
 */
export const withConcurrencyLimit = <T, E, R>(
  tasks: ReadonlyArray<Effect.Effect<T, E, R>>,
  max: number,
): Effect.Effect<readonly T[], E, R> =>
  Effect.all(tasks, { concurrency: max });
