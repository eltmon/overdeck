/**
 * Cloister Health History Database
 *
 * SQLite storage for agent health events and history.
 * Stores health state transitions for visualization and analysis.
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { openDatabase, type SqliteDatabase } from '../database/driver.js';
import { OVERDECK_HOME } from '../paths.js';
import type { HealthState } from '../runtimes/types.js';

const CLOISTER_DB_PATH = join(OVERDECK_HOME, 'cloister.db');
const RETENTION_DAYS = 7;

/**
 * Health event stored in database
 */
export interface HealthEvent {
  id?: number;
  agentId: string;
  timestamp: string; // ISO 8601
  state: HealthState;
  previousState?: string;
  source?: string; // jsonl_mtime, tmux_activity, git_activity, active_heartbeat
  metadata?: string; // JSON string
}

/**
 * Health event with parsed metadata
 */
export interface HealthEventWithMetadata extends Omit<HealthEvent, 'metadata'> {
  metadata?: Record<string, unknown>;
}

let db: SqliteDatabase | null = null;

/**
 * Initialize the health history database
 *
 * Creates the database file and schema if they don't exist.
 * Safe to call multiple times - idempotent.
 */
function initHealthDatabase(): SqliteDatabase {
  // Ensure overdeck home exists
  if (!existsSync(OVERDECK_HOME)) {
    mkdirSync(OVERDECK_HOME, { recursive: true });
  }

  // Open or create database
  db = openDatabase(CLOISTER_DB_PATH);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS health_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      state TEXT NOT NULL,
      previous_state TEXT,
      source TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_timestamp
      ON health_events(agent_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_timestamp
      ON health_events(timestamp);
  `);

  // Run cleanup on initialization
  cleanupOldEventsSync(db);

  return db;
}

/**
 * Get the database instance, initializing if necessary
 */
function getHealthDatabase(): SqliteDatabase {
  if (!db) {
    return initHealthDatabase();
  }
  return db;
}

/**
 * Delete health events older than the retention period
 *
 * @param database - Database instance
 * @param retentionDays - Number of days to retain (default: 7)
 * @returns Number of events deleted
 */
function cleanupOldEventsSync(
  database: SqliteDatabase = getHealthDatabase(),
  retentionDays: number = RETENTION_DAYS
): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTimestamp = cutoffDate.toISOString();

  const stmt = database.prepare(`
    DELETE FROM health_events
    WHERE timestamp < ?
  `);

  const result = stmt.run(cutoffTimestamp);
  return result.changes;
}
