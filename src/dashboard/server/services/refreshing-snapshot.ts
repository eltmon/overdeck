/** Shared polling snapshot: one refresh, bounded last-good data, and failure backoff. */
export function createRefreshingSnapshot<T>(
  load: () => Promise<T>,
  options: { ttlMs: number; maxAgeMs: number; retryMs: number },
): { get: () => Promise<T> } {
  let snapshot: { value: T; at: number } | undefined;
  let inFlight: Promise<T> | undefined;
  let retryAt = 0;
  let lastError: unknown;

  function refresh(): Promise<T> {
    if (inFlight) return inFlight;
    if (Date.now() < retryAt) return Promise.reject(lastError);
    inFlight = Promise.resolve().then(load).then(value => {
      snapshot = { value, at: Date.now() };
      retryAt = 0;
      return value;
    }, error => {
      lastError = error;
      retryAt = Date.now() + options.retryMs;
      throw error;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return {
    get() {
      if (snapshot && Date.now() - snapshot.at < options.maxAgeMs) {
        if (Date.now() - snapshot.at >= options.ttlMs && Date.now() >= retryAt) {
          // Readers keep the last good value while one background refresh runs.
          void refresh().catch(() => {});
        }
        return Promise.resolve(snapshot.value);
      }
      // Cold/expired reads share work and retain the route's existing error path.
      return refresh();
    },
  };
}
