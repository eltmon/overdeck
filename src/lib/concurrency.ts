export function withConcurrencyLimit<T>(
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
  value?: T;
}

export interface SettledTtlPromiseCache<K, V> {
  (key: K, load: () => Promise<V>): Promise<V>;
  /** Drop one key's settled value (or every key when omitted) so the next read reloads. In-flight loads are untouched. */
  invalidate(key?: K): void;
}

/**
 * Cache settled values for a TTL while preserving single-flight for pending
 * work regardless of age. `ttlFor`, when given, overrides `ttlMs` per settled
 * value — e.g. a longer TTL for an "idle" answer than a "busy" one — and is
 * ignored for rejected loads, which keep today's behavior (entry dropped).
 */
export function createSettledTtlPromiseCache<K, V>(
  ttlMs: number,
  now: () => number = () => Date.now(),
  ttlFor?: (value: V) => number,
): SettledTtlPromiseCache<K, V> {
  const entries = new Map<K, SettledTtlEntry<V>>();
  const get = (key: K, load: () => Promise<V>): Promise<V> => {
    const cached = entries.get(key);
    if (cached) {
      if (cached.settledAt === null) return cached.promise;
      const ttl = ttlFor ? ttlFor(cached.value as V) : ttlMs;
      if (now() - cached.settledAt < ttl) return cached.promise;
    }

    const entry: SettledTtlEntry<V> = { promise: load(), settledAt: null };
    entries.set(key, entry);
    entry.promise.then(
      (value) => { entry.settledAt = now(); entry.value = value; },
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
