/**
 * Client-side snapshot cache (PAN-437)
 *
 * Persists the DashboardSnapshot to localStorage so the UI can render
 * immediately on page load — before the WebSocket connects and the server
 * returns a fresh snapshot.
 *
 * Cache key is versioned so old incompatible snapshots are silently ignored.
 * If localStorage quota is exceeded, the issues array is stripped and retried.
 */

import type { DashboardSnapshot } from '@panctl/contracts'

const CACHE_KEY = 'pan-snapshot-cache-v1'

interface CacheEntry {
  data: DashboardSnapshot
  timestamp: string
}

function serialize(snapshot: DashboardSnapshot): string {
  return JSON.stringify({ data: snapshot, timestamp: new Date().toISOString() } satisfies CacheEntry)
}

/**
 * Save a DashboardSnapshot to localStorage.
 * On QuotaExceededError, retries with the issues array stripped.
 */
export function saveSnapshotToCache(snapshot: DashboardSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, serialize(snapshot))
  } catch (err) {
    // Retry with issues stripped if quota was exceeded
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      try {
        const stripped: DashboardSnapshot = { ...snapshot, issues: [] }
        localStorage.setItem(CACHE_KEY, serialize(stripped))
      } catch {
        // localStorage genuinely full or unavailable — ignore
      }
    }
    // localStorage may be unavailable (private browsing) — ignore
  }
}

/**
 * Load a DashboardSnapshot from localStorage.
 * Returns null if not found, corrupt, or from an incompatible schema version.
 */
export function loadSnapshotFromCache(): DashboardSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null

    const entry = JSON.parse(raw) as CacheEntry
    if (!entry?.data?.sequence) return null

    return entry.data
  } catch {
    return null
  }
}

/**
 * Clear the cached snapshot (e.g., on logout or reset).
 */
export function clearSnapshotCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
}
