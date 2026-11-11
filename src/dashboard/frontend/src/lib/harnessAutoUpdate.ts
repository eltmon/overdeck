/**
 * PAN-5108: fetch the background harness CLI updater's snapshot. Like
 * fetchDiskAlert, it THROWS on a non-ok response or network error, so a
 * rejected refetch leaves React Query's `data` at the last successful
 * snapshot and a transient failure never hides an update failure. Does not
 * import useDecisions (lint:circular).
 */
import type { HarnessAutoUpdateSnapshot } from '@overdeck/contracts';
import { fetchWithTimeout } from './apiFetch';

export const HARNESS_AUTO_UPDATE_QUERY_KEY = ['harness-auto-update'] as const;

export async function fetchHarnessAutoUpdate(signal?: AbortSignal): Promise<HarnessAutoUpdateSnapshot> {
  const res = await fetchWithTimeout('/api/harness-auto-update', { signal });
  if (!res.ok) throw new Error(`GET /api/harness-auto-update failed: ${res.status}`);
  return res.json() as Promise<HarnessAutoUpdateSnapshot>;
}
