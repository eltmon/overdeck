import { Effect } from 'effect';

export function withConcurrencyLimitPromise<T>(
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

interface SettledTtlEntry<T> {
  promise: Promise<T>;
  settledAt: number | null;
}

/** Cache settled values for a TTL while preserving single-flight for pending work regardless of age. */
export function createSettledTtlPromiseCache<K, V>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<K, SettledTtlEntry<V>>();
  return (key: K, load: () => Promise<V>): Promise<V> => {
    const cached = entries.get(key);
    if (cached && (cached.settledAt === null || now() - cached.settledAt < ttlMs)) return cached.promise;

    const entry: SettledTtlEntry<V> = { promise: load(), settledAt: null };
    entries.set(key, entry);
    entry.promise.then(
      () => { entry.settledAt = now(); },
      () => { if (entries.get(key) === entry) entries.delete(key); },
    );
    return entry.promise;
  };
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
