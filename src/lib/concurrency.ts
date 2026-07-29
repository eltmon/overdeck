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

export interface SettledTtlPromiseCache<K, V> {
  (key: K, load: () => Promise<V>): Promise<V>;
  /** Drop one key's settled value (or every key when omitted) so the next read reloads. In-flight loads are untouched. */
  invalidate(key?: K): void;
}

/** Cache settled values for a TTL while preserving single-flight for pending work regardless of age. */
export function createSettledTtlPromiseCache<K, V>(ttlMs: number, now: () => number = () => Date.now()): SettledTtlPromiseCache<K, V> {
  const entries = new Map<K, SettledTtlEntry<V>>();
  const get = (key: K, load: () => Promise<V>): Promise<V> => {
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
  get.invalidate = (key?: K): void => {
    if (key === undefined) {
      for (const [k, entry] of entries) {
        if (entry.settledAt !== null) entries.delete(k);
      }
      return;
    }
    if (entries.get(key)?.settledAt !== null) entries.delete(key);
  };
  return get;
}

/** Schedule promise work through one limiter shared by every caller of the returned function. */
export function createPromiseConcurrencyLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const drain = () => {
    while (active < max && queue.length > 0) queue.shift()!();
  };
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active++;
      task().then(resolve, reject).finally(() => {
        active--;
        drain();
      });
    });
    drain();
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
