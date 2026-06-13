/**
 * fetchWithTimeout — fetch that cannot hang forever (PAN-1705).
 *
 * Dashboard API fetches used to have no timeout. When a server restart (e.g.
 * `pan reload` from a shipping agent) killed the backend while a request was
 * in flight, Traefik held the client side open and the fetch hung for minutes
 * — React Query sat in `isLoading` ("Loading…") indefinitely because the
 * promise never settled, and its network-error retry never fired.
 *
 * The timeout signal is combined with any caller-provided signal (e.g. React
 * Query's per-query abort signal), so query cancellation keeps working.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(input, {
    ...rest,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}
