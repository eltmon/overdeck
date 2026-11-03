/**
 * Outbound fetch with a hard timeout for the push providers (PRD PAN-4830 WI-3, D-12, NFR-3).
 *
 * AbortController + setTimeout rather than AbortSignal.timeout(), which ignores vi.useFakeTimers();
 * the race also covers a fetch implementation that ignores the abort signal (turn.ts pattern).
 */

export const PUSH_FETCH_TIMEOUT_MS = 2_000;

/** Resolves with the response, or rejects on a network error or after `ms` without one. */
export async function fetchWithTimeout(fetchFn: typeof fetch, url: string, init: RequestInit, ms = PUSH_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, ms);
  });
  const work = fetchFn(url, { ...init, signal: controller.signal });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    work.catch(() => undefined);
  }
}
