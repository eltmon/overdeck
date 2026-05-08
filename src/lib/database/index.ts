/**
 * Panopticon Unified Database
 *
 * Single panopticon.db at ~/.panopticon/panopticon.db.
 * Singleton pattern — one connection shared across the process.
 *
 * IMPORTANT: This module is safe to import in both server and CLI contexts.
 * Never use execSync here — this is synchronous SQLite, not a subprocess.
 *
 * Dual-runtime (PAN-428):
 *   - Bun: uses bun:sqlite (better-sqlite3 is a native addon — ERR_DLOPEN_FAILED in Bun)
 *   - Node: uses better-sqlite3
 * In both cases the external API is identical: pragma(), exec(), prepare(), close().
 */

import type Database from 'better-sqlite3';
import { createRequire } from 'module';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getPanopticonHome } from '../paths.js';
import { runMigrations } from './schema.js';

declare const Bun: unknown;

function isBunRuntime(): boolean {
  return typeof Bun !== 'undefined';
}

// createRequire allows synchronous require() in ESM — works in both Bun and Node
const _require = createRequire(import.meta.url);

let _db: Database.Database | null = null;

/**
 * Get the path to panopticon.db (dynamic, respects PANOPTICON_HOME override for tests)
 */
export function getDatabasePath(): string {
  return join(getPanopticonHome(), 'panopticon.db');
}

/**
 * Initialize and return the singleton database connection.
 * Safe to call multiple times — returns the existing connection after first call.
 */
export function getDatabase(): Database.Database {
  if (_db) {
    return _db;
  }

  const home = getPanopticonHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }

  const dbPath = getDatabasePath();

  if (isBunRuntime()) {
    // better-sqlite3 is a native Node.js addon that fails in Bun with ERR_DLOPEN_FAILED.
    // Use bun:sqlite instead, with a pragma() shim for API compatibility.
    const { Database: BunDatabase } = _require('bun:sqlite') as { Database: new (path: string) => any };
    const bunDb = new BunDatabase(dbPath);

    // bun:sqlite has no pragma() method — shim it using exec() and query().get()
    bunDb.pragma = function (sql: string, options?: { simple?: boolean }): any {
      if (options?.simple) {
        // Read-only: return the scalar value directly (e.g. db.pragma('user_version', { simple: true }))
        const key = sql.trim();
        const row = bunDb.query(`PRAGMA ${key}`).get() as Record<string, unknown> | null;
        return row?.[key] ?? null;
      }
      // Set or no-return pragma (e.g. 'journal_mode = WAL', 'foreign_keys = ON')
      bunDb.exec(`PRAGMA ${sql}`);
      return undefined;
    };

    _db = bunDb as Database.Database;
  } else {
    // Node.js path: load better-sqlite3 lazily (avoids import-time native addon load)
    const BetterSqlite3 = _require('better-sqlite3');
    _db = new BetterSqlite3(dbPath) as Database.Database;
  }

  // Enable WAL mode for concurrent readers + single writer
  _db.pragma('journal_mode = WAL');
  // Enforce foreign keys
  _db.pragma('foreign_keys = ON');
  // Write-ahead log synchronization — NORMAL is safe and fast
  _db.pragma('synchronous = NORMAL');
  // Cap WAL file size at 64 MB. Without this, SQLite's autocheckpoint only
  // RESETS the WAL (rewinds to offset 0); the file itself never shrinks
  // and grows to its lifetime high-water mark. Empirically observed at
  // 489 MB after a few days of agent activity, contributing to system-wide
  // disk thrashing. The limit only takes effect after a checkpoint, so we
  // also schedule a periodic TRUNCATE checkpoint below.
  _db.pragma('journal_size_limit = 67108864');

  // Initialize or migrate schema
  runMigrations(_db);

  // Periodic TRUNCATE checkpoint — once per minute. Belt-and-suspenders
  // alongside journal_size_limit: if a long-lived reader has been holding a
  // WAL frame, autocheckpoint upgrades won't cap the file. TRUNCATE forces
  // the WAL back to zero bytes whenever no readers are blocking.
  setInterval(() => {
    try { _db?.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  }, 60_000).unref();

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
 * Used in tests after PANOPTICON_HOME changes.
 */
export function resetDatabase(): void {
  closeDatabase();
}
