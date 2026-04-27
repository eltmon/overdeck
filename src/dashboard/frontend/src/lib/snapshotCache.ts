/**
 * Client-side snapshot cache (PAN-437)
 *
 * Persists the DashboardSnapshot to localStorage so the UI can render
 * immediately on page load — before the WebSocket connects and the server
 * returns a fresh snapshot.
 *
 * Cache key is versioned so old incompatible snapshots are silently ignored.
 * If the snapshot is too large (> 2MB), output buffers are stripped first.
 */

import type { DashboardSnapshot } from '@panctl/contracts'

const CACHE_KEY = 'pan-snapshot-cache-v1'
const MAX_BYTES = 2 * 1024 * 1024 // 2MB

interface CacheEntry {
  data: DashboardSnapshot
  timestamp: string
}

/**
 * Save a DashboardSnapshot to localStorage.
 * Strips large fields if the serialized size exceeds MAX_BYTES.
 */
export function saveSnapshotToCache(snapshot: DashboardSnapshot): void {
  try {
    let serialized = JSON.stringify({ data: snapshot, timestamp: new Date().toISOString() } satisfies CacheEntry)

    if (serialized.length > MAX_BYTES) {
      // Strip issues array (largest field) to bring size down
      const stripped: DashboardSnapshot = { ...snapshot, issues: [] }
      serialized = JSON.stringify({ data: stripped, timestamp: new Date().toISOString() } satisfies CacheEntry)
    }

    localStorage.setItem(CACHE_KEY, serialized)
  } catch {
    // localStorage may be unavailable (private browsing) or full — ignore
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
