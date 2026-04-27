/**
 * Projection Cache Service (PAN-437)
 *
 * Persists the full DashboardSnapshot to SQLite so the server can serve
 * data instantly on startup without waiting for API fetches.
 *
 * Uses the same DB connection as the event store (shared DbAdapter).
 * Writes are debounced at 100ms to avoid thrashing during event bursts.
 */

import type { DbAdapter } from '../event-store.js';
import type { DashboardSnapshot } from '@panctl/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheRow {
  key: string;
  data: string;
  sequence: number;
  updated_at: string;
}

export interface ProjectionCache {
  /** Load the cached DashboardSnapshot. Returns null if not found or corrupt. */
  load(): DashboardSnapshot | null;
  /** Persist the snapshot (debounced at 100ms). */
  save(snapshot: DashboardSnapshot): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

const CACHE_KEY = 'dashboard';

export function createProjectionCache(db: DbAdapter): ProjectionCache {
  const loadStmt = db.prepare<CacheRow>(
    `SELECT key, data, sequence, updated_at FROM projection_cache WHERE key = ?`,
  );
  const upsertStmt = db.prepare<void>(
    `INSERT INTO projection_cache (key, data, sequence, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       data = excluded.data,
       sequence = excluded.sequence,
       updated_at = excluded.updated_at`,
  );

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: DashboardSnapshot | null = null;

  function load(): DashboardSnapshot | null {
    try {
      const row = loadStmt.get([CACHE_KEY]);
      if (!row) return null;
      const parsed = JSON.parse(row.data) as DashboardSnapshot;
      console.log(
        `[projection-cache] Loaded snapshot: seq=${row.sequence}, ` +
        `updated=${row.updated_at}, agents=${(parsed.agents ?? []).length}, ` +
        `issues=${(parsed.issues ?? []).length}`,
      );
      return parsed;
    } catch (err) {
      console.warn('[projection-cache] Failed to load cached snapshot:', err);
      return null;
    }
  }

  function flush(): void {
    if (!pendingSnapshot) return;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    debounceTimer = null;
    try {
      upsertStmt.run([
        CACHE_KEY,
        JSON.stringify(snapshot),
        snapshot.sequence,
        new Date().toISOString(),
      ]);
    } catch (err) {
      console.warn('[projection-cache] Failed to save snapshot:', err);
    }
  }

  function save(snapshot: DashboardSnapshot): void {
    pendingSnapshot = snapshot;
    if (debounceTimer !== null) return; // Already scheduled
    debounceTimer = setTimeout(flush, 100);
  }

  return { load, save };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _cache: ProjectionCache | null = null;

/**
 * Initialize the ProjectionCache with the shared DbAdapter.
 * Called from initEventStore() after the DB is opened.
 */
export function initProjectionCache(db: DbAdapter): ProjectionCache {
  if (_cache) return _cache;
  _cache = createProjectionCache(db);
  return _cache;
}

/**
 * Return the singleton ProjectionCache. Throws if not yet initialized.
 */
export function getProjectionCache(): ProjectionCache {
  if (!_cache) {
    throw new Error('[projection-cache] getProjectionCache() called before initProjectionCache().');
  }
  return _cache;
}
