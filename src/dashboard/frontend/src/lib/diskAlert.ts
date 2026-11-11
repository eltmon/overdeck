/**
 * PAN-5093: fetch the disk alert snapshot. Unlike most Needs-you fetchers,
 * this one THROWS on a non-ok response or network error instead of returning
 * a fallback value — a rejected refetch then leaves React Query's `data` at
 * the last successful snapshot, so a transient failure never hides an active
 * alert (WI-6 critique response). Does not import useDecisions (lint:circular).
 */
import type { DiskAlertSnapshot } from '@overdeck/contracts';
import { fetchWithTimeout } from './apiFetch';

export const DISK_ALERT_QUERY_KEY = ['disk-alert'] as const;

export async function fetchDiskAlert(signal?: AbortSignal): Promise<DiskAlertSnapshot> {
  const res = await fetchWithTimeout('/api/disk-alert', { signal });
  if (!res.ok) throw new Error(`GET /api/disk-alert failed: ${res.status}`);
  return res.json() as Promise<DiskAlertSnapshot>;
}
