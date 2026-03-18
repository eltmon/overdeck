/**
 * Panopticon Unified Database
 *
 * Single panopticon.db at ~/.panopticon/panopticon.db.
 * Singleton pattern — one connection shared across the process.
 *
 * IMPORTANT: This module is safe to import in both server and CLI contexts.
 * Never use execSync here — this is synchronous SQLite, not a subprocess.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getPanopticonHome } from '../paths.js';
import { runMigrations } from './schema.js';

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
  _db = new Database(dbPath);

  // Enable WAL mode for concurrent readers + single writer
  _db.pragma('journal_mode = WAL');
  // Enforce foreign keys
  _db.pragma('foreign_keys = ON');
  // Write-ahead log synchronization — NORMAL is safe and fast
  _db.pragma('synchronous = NORMAL');

  // Initialize or migrate schema
  runMigrations(_db);

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
