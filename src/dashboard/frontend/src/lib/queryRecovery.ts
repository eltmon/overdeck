/**
 * queryRecovery (PAN-3527) — keep the Command Deck's project and conversation
 * lists from latching an empty state after a transient failure.
 *
 * The sidebar project list, the registered-project registry and the
 * conversation list load over REST, not the /ws/rpc read model.
 * A dashboard restart used to leave them empty ("CONVERSATIONS 0 / ISSUES 0")
 * until something else refetched them: a 5xx or timeout was not retried (the
 * global retry only covers fetch TypeErrors), and a fetch that hung during the
 * first load could not be cancelled by invalidation, so every later poll
 * joined the hung request instead of starting a new one.
 *
 * Two recovery paths, installed once on the app's QueryClient:
 * - Retry with exponential backoff: any failure of these queries retries
 *   (1s, 2s, 4s, 8s, 16s) before settling as an error. The query stays
 *   pending meanwhile, so the UI shows loading instead of an empty list.
 * - Refetch on backend reconnect: when EventRouter re-bootstraps after the
 *   RPC websocket reconnects, in-flight fetches are cancelled and the queries
 *   refetched against the new server instance.
 *
 * The pipeline-membership banner (`project-pipeline-membership`) shares the
 * reconnect refetch but keeps its own retry policy: it retries only transient
 * failures, honoring the server's Retry-After (ProjectMembershipBoundary).
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { BACKEND_RECONNECTED_EVENT } from './backendConnectionEvents';

export const RECOVERY_RETRY_ATTEMPTS = 5;
export const RECOVERY_RETRY_BASE_DELAY_MS = 1_000;
export const RECOVERY_RETRY_MAX_DELAY_MS = 30_000;

/** Query key prefixes that recover on their own after a transient failure. */
export const RECOVERING_QUERY_KEYS: readonly QueryKey[] = [
  ['command-deck-projects'],
  ['registered-projects'],
  ['conversations'],
  // The membership banner retries its own transient failures (its observer
  // overrides this retry policy); it shares the reconnect refetch.
  ['project-pipeline-membership'],
];

export function recoveryRetryDelayMs(failureCount: number): number {
  return Math.min(RECOVERY_RETRY_BASE_DELAY_MS * 2 ** failureCount, RECOVERY_RETRY_MAX_DELAY_MS);
}

/**
 * Cancel any in-flight fetch (it may be hung against the dead server) and
 * refetch every recovering query.
 */
export async function refetchRecoveringQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all(RECOVERING_QUERY_KEYS.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  await Promise.all(RECOVERING_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/**
 * Install the retry policy and the reconnect listener. Observers that pass
 * their own `retry`/`retryDelay` still override these key defaults.
 * Returns an uninstall function for tests.
 */
export function installQueryRecovery(queryClient: QueryClient): () => void {
  for (const queryKey of RECOVERING_QUERY_KEYS) {
    queryClient.setQueryDefaults(queryKey, {
      retry: RECOVERY_RETRY_ATTEMPTS,
      retryDelay: recoveryRetryDelayMs,
    });
  }
  const handleReconnected = () => {
    void refetchRecoveringQueries(queryClient);
  };
  window.addEventListener(BACKEND_RECONNECTED_EVENT, handleReconnected);
  return () => window.removeEventListener(BACKEND_RECONNECTED_EVENT, handleReconnected);
}
