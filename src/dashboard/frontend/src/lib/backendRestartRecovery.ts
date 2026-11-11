/**
 * PAN-5091: the terminal-backend restart recovery offer. Like fetchDiskAlert,
 * the fetch THROWS on a non-ok response or network error, so a rejected
 * refetch leaves React Query's `data` at the last successful snapshot. Does
 * not import useDecisions (lint:circular).
 */
import type { BackendRestartRecoverySnapshot } from '@overdeck/contracts';
import { fetchWithTimeout } from './apiFetch';

export const BACKEND_RESTART_RECOVERY_QUERY_KEY = ['backend-restart-recovery'] as const;

export async function fetchBackendRestartRecovery(signal?: AbortSignal): Promise<BackendRestartRecoverySnapshot> {
  const res = await fetchWithTimeout('/api/backend-restart-recovery', { signal });
  if (!res.ok) throw new Error(`GET /api/backend-restart-recovery failed: ${res.status}`);
  return res.json() as Promise<BackendRestartRecoverySnapshot>;
}

/** POST one of the offer's actions; resolves with the route's error text, or null on success. */
export async function postBackendRestartRecovery(action: 'resume-all' | 'dismiss'): Promise<string | null> {
  try {
    const res = await fetch(`/api/backend-restart-recovery/${action}`, { method: 'POST' });
    if (res.ok) return null;
    const body = await res.json().catch(() => null) as { error?: string } | null;
    return body?.error ?? `HTTP ${res.status}`;
  } catch {
    return 'Could not reach the dashboard';
  }
}
