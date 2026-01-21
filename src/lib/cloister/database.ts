/**
 * Cloister Health History Database
 *
 * SQLite storage for agent health events and history.
 * Stores health state transitions for visualization and analysis.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { PANOPTICON_HOME } from '../paths.js';
import type { HealthState } from '../runtimes/types.js';

const CLOISTER_DB_PATH = join(PANOPTICON_HOME, 'cloister.db');
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
  metadata?: Record<string, any>;
}

let db: Database.Database | null = null;

/**
 * Initialize the health history database
 *
 * Creates the database file and schema if they don't exist.
 * Safe to call multiple times - idempotent.
 */
export function initHealthDatabase(): Database.Database {
  // Ensure panopticon home exists
  if (!existsSync(PANOPTICON_HOME)) {
    mkdirSync(PANOPTICON_HOME, { recursive: true });
  }

  // Open or create database
  db = new Database(CLOISTER_DB_PATH);

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
  cleanupOldEvents(db);

  return db;
}

/**
 * Get the database instance, initializing if necessary
 */
export function getHealthDatabase(): Database.Database {
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
 * Write a health event to the database
 *
 * @param event - Health event to store
 * @returns The ID of the inserted event
 */
export function writeHealthEvent(event: Omit<HealthEvent, 'id'>): number {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    INSERT INTO health_events (agent_id, timestamp, state, previous_state, source, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    event.agentId,
    event.timestamp,
    event.state,
    event.previousState || null,
    event.source || null,
    event.metadata || null
  );

  return result.lastInsertRowid as number;
}

/**
 * Write multiple health events in a transaction
 *
 * @param events - Array of health events to store
 * @returns Number of events inserted
 */
export function writeHealthEvents(events: Omit<HealthEvent, 'id'>[]): number {
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
 * Get health events for an agent within a time range
 *
 * @param agentId - Agent identifier
 * @param startTime - Start of time range (ISO 8601)
 * @param endTime - End of time range (ISO 8601)
 * @returns Array of health events, ordered by timestamp
 */
export function getHealthHistory(
  agentId: string,
  startTime: string,
  endTime: string
): HealthEventWithMetadata[] {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
           source, metadata
    FROM health_events
    WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const events = stmt.all(agentId, startTime, endTime) as HealthEvent[];

  // Parse metadata JSON
  return events.map((event) => ({
    ...event,
    metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
  }));
}

/**
 * Get recent health events for an agent
 *
 * @param agentId - Agent identifier
 * @param limit - Maximum number of events to return (default: 100)
 * @returns Array of health events, ordered by timestamp descending
 */
export function getRecentHealthHistory(
  agentId: string,
  limit: number = 100
): HealthEventWithMetadata[] {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
           source, metadata
    FROM health_events
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  const events = stmt.all(agentId, limit) as HealthEvent[];

  // Parse metadata JSON and reverse to get chronological order
  return events
    .map((event) => ({
      ...event,
      metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
    }))
    .reverse();
}

/**
 * Get health events for all agents within a time range
 *
 * @param startTime - Start of time range (ISO 8601)
 * @param endTime - End of time range (ISO 8601)
 * @returns Array of health events, ordered by timestamp
 */
export function getAllHealthHistory(
  startTime: string,
  endTime: string
): HealthEventWithMetadata[] {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
           source, metadata
    FROM health_events
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const events = stmt.all(startTime, endTime) as HealthEvent[];

  // Parse metadata JSON
  return events.map((event) => ({
    ...event,
    metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
  }));
}

/**
 * Get the latest health event for an agent
 *
 * @param agentId - Agent identifier
 * @returns Latest health event or null if none exist
 */
export function getLatestHealthEvent(agentId: string): HealthEventWithMetadata | null {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
           source, metadata
    FROM health_events
    WHERE agent_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `);

  const event = stmt.get(agentId) as HealthEvent | undefined;

  if (!event) {
    return null;
  }

  return {
    ...event,
    metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
  };
}

/**
 * Get list of all agents with health history
 *
 * @returns Array of unique agent IDs
 */
export function getAgentsWithHistory(): string[] {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    SELECT DISTINCT agent_id as agentId
    FROM health_events
    ORDER BY agent_id ASC
  `);

  const results = stmt.all() as { agentId: string }[];
  return results.map((r) => r.agentId);
}

/**
 * Delete health events older than the retention period
 *
 * @param database - Database instance
 * @param retentionDays - Number of days to retain (default: 7)
 * @returns Number of events deleted
 */
export function cleanupOldEvents(
  database: Database.Database = getHealthDatabase(),
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
 * Delete all health events for a specific agent
 *
 * @param agentId - Agent identifier
 * @returns Number of events deleted
 */
export function deleteAgentHistory(agentId: string): number {
  const database = getHealthDatabase();

  const stmt = database.prepare(`
    DELETE FROM health_events
    WHERE agent_id = ?
  `);

  const result = stmt.run(agentId);
  return result.changes;
}

/**
 * Get database statistics
 *
 * @returns Statistics about the health history database
 */
export function getDatabaseStats(): {
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
