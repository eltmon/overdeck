/**
 * Overdeck Unified Database
 *
 * Single panopticon.db at ~/.panopticon/panopticon.db.
 * Singleton pattern — one connection shared across the process.
 *
 * IMPORTANT: This module is safe to import in both server and CLI contexts.
 * Never use execSync here — this is synchronous SQLite, not a subprocess.
 *
 * Dual-runtime (PAN-1579): uses the shared SQLite driver adapter, which selects
 * bun:sqlite under Bun and node:sqlite under Node.
 */

import { Data, Effect } from 'effect';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getOverdeckHome } from '../paths.js';
import { openDatabase, type SqliteDatabase } from './driver.js';
import { runMigrations } from './schema.js';

/**
 * PAN-1249: Local typed error for SQLite failures against panopticon.db.
 * Used by callers that want to surface DB faults instead of swallowing them.
 * Full conversion to @effect/sql-sqlite-bun is deferred to PAN-447.
 */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

let _db: SqliteDatabase | null = null;

/**
 * Get the path to panopticon.db (dynamic, respects OVERDECK_HOME override for tests)
 */
export function getDatabasePath(): string {
  return join(getOverdeckHome(), 'panopticon.db');
}

/**
 * Initialize and return the singleton database connection.
 * Safe to call multiple times — returns the existing connection after first call.
 */
export function getDatabase(): SqliteDatabase {
  if (_db) {
    return _db;
  }

  const home = getOverdeckHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }

  const dbPath = getDatabasePath();
  _db = openDatabase(dbPath);

  // Enable WAL mode for concurrent readers + single writer
  _db.pragma('journal_mode = WAL');
  // Enforce foreign keys
  _db.pragma('foreign_keys = ON');
  // Write-ahead log synchronization — NORMAL is safe and fast
  _db.pragma('synchronous = NORMAL');
  // Cap WAL file size at 64 MB. SQLite's wal_autocheckpoint (default every
  // 1000 pages) only RESETS the WAL — it rewinds the write pointer to offset
  // 0 so subsequent writes overwrite earlier ones, but it never shrinks the
  // file. Without journal_size_limit the file grows to its lifetime
  // high-water mark and stays there. Observed at 489 MB after a few days of
  // agent activity. With the limit set, every successful autocheckpoint
  // truncates the WAL back to 64 MB. If the WAL ever grows past that
  // ceiling, it means autocheckpoint is failing — that's a real signal we
  // want to surface, not paper over with periodic TRUNCATE calls.
  _db.pragma('journal_size_limit = 67108864');

  // Initialize or migrate schema
  runMigrations(_db, dbPath);

  // One-time migration: enable incremental auto_vacuum.
  //
  // SQLite's auto_vacuum default is NONE — when rows are deleted the freed
  // pages stay allocated to the file forever. Overdeck's event store and
  // status_history are aggressively retained (95%+ of rows are eventually
  // deleted), so without auto_vacuum the file just grows monotonically.
  // Observed at 1.1 GB on disk for 154 MB of live data (904 MB freelist).
  //
  // Switching auto_vacuum modes requires VACUUM to take effect. We run it
  // once on startup if the DB is still in NONE mode. VACUUM blocks the
  // event loop (SQLite driver is synchronous) but this happens BEFORE the
  // HTTP server starts, so no in-flight requests are affected.
  const currentVacuum = _db.pragma('auto_vacuum', { simple: true }) as number;
  if (currentVacuum !== 2) {
    const sizeBefore = _db.pragma('page_count', { simple: true }) as number;
    const pageSize = _db.pragma('page_size', { simple: true }) as number;
    const mbBefore = (sizeBefore * pageSize / 1024 / 1024).toFixed(1);
    console.log(`[db] Migrating SQLite to incremental_vacuum (current=${currentVacuum}, size=${mbBefore}MB) — one-time, may take ~30s on a large DB...`);
    const t0 = Date.now();
    _db.pragma('auto_vacuum = INCREMENTAL');
    _db.exec('VACUUM');
    const sizeAfter = _db.pragma('page_count', { simple: true }) as number;
    const mbAfter = (sizeAfter * pageSize / 1024 / 1024).toFixed(1);
    console.log(`[db] Migration complete in ${Date.now() - t0}ms (${mbBefore}MB → ${mbAfter}MB)`);
  }

  // Periodic freelist reclamation. With auto_vacuum=INCREMENTAL, deleted
  // pages go on a freelist but stay allocated until incremental_vacuum is
  // called explicitly. Run every 15 minutes; reclaims pages back to the OS
  // without needing a VACUUM. Bounded at 10000 pages per pass (~40 MB) so
  // any single call is short. .unref() so it doesn't block process exit.
  setInterval(() => {
    if (!_db) return;
    const db = _db;
    Effect.runSync(
      Effect.try({
        try: () => {
          const free = db.pragma('freelist_count', { simple: true }) as number;
          if (free > 256) {
            db.pragma(`incremental_vacuum(${Math.min(free, 10000)})`);
          }
        },
        catch: (cause) => new DatabaseError({ operation: 'incremental_vacuum', cause }),
      }).pipe(Effect.catchTag('DatabaseError', () => Effect.void)), // non-fatal
    );
  }, 15 * 60 * 1000).unref();

  return _db;
}

/**
 * Close the database connection and release the singleton.
 * Primarily used in tests to get a fresh connection.
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Force re-initialization of the database connection.
 * Used in tests after OVERDECK_HOME changes.
 */
export function resetDatabase(): void {
  closeDatabase();
}
