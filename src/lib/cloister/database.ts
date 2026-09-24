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
export function initHealthDatabase(): SqliteDatabase {
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
export function getHealthDatabase(): SqliteDatabase {
  if (!db) {
    return initHealthDatabase();
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeHealthDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Write multiple health events in a transaction
 *
 * @param events - Array of health events to store
 * @returns Number of events inserted
 */
export function writeHealthEventsSync(events: Omit<HealthEvent, 'id'>[]): number {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    INSERT INTO health_events (agent_id, timestamp, state, previous_state, source, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((eventsToInsert: Omit<HealthEvent, 'id'>[]) => {
    for (const event of eventsToInsert) {
      stmt.run(
        event.agentId,
        event.timestamp,
        event.state,
        event.previousState || null,
        event.source || null,
        event.metadata || null
      );
    }
    return eventsToInsert.length;
  });

  return insertMany(events);
}

/**
 * Delete health events older than the retention period
 *
 * @param database - Database instance
 * @param retentionDays - Number of days to retain (default: 7)
 * @returns Number of events deleted
 */
export function cleanupOldEventsSync(
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

/**
 * Get database statistics
 *
 * @returns Statistics about the health history database
 */
export function getDatabaseStatsSync(): {
  totalEvents: number;
  uniqueAgents: number;
  oldestEvent: string | null;
  newestEvent: string | null;
} {
  const database = getHealthDatabase();

  const countStmt = database.prepare('SELECT COUNT(*) as count FROM health_events');
  const agentStmt = database.prepare('SELECT COUNT(DISTINCT agent_id) as count FROM health_events');
  const oldestStmt = database.prepare('SELECT MIN(timestamp) as oldest FROM health_events');
  const newestStmt = database.prepare('SELECT MAX(timestamp) as newest FROM health_events');

  const totalEvents = (countStmt.get() as { count: number }).count;
  const uniqueAgents = (agentStmt.get() as { count: number }).count;
  const oldestEvent = (oldestStmt.get() as { oldest: string | null }).oldest;
  const newestEvent = (newestStmt.get() as { newest: string | null }).newest;

  return {
    totalEvents,
    uniqueAgents,
    oldestEvent,
    newestEvent,
  };
}
