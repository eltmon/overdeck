/**
 * Cloister Health History Database
 *
 * SQLite storage for agent health events and history.
 * Stores health state transitions for visualization and analysis.
 */

import type Database from 'better-sqlite3';
import { createRequire } from 'module';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Data, Effect } from 'effect';
import { PANOPTICON_HOME } from '../paths.js';

/**
 * Local error class for the cloister health-history SQLite store. Distinct from
 * `DatabaseError` in the application-settings store because this layer
 * (better-sqlite3 / bun:sqlite, sync API) has different failure surfaces.
 */
export class CloisterDatabaseError extends Data.TaggedError('CloisterDatabaseError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

declare const Bun: unknown;
const _require = createRequire(import.meta.url);

function openSqliteDb(dbPath: string): Database.Database {
  if (typeof Bun !== 'undefined') {
    const { Database: BunDatabase } = _require('bun:sqlite') as { Database: new (path: string) => any };
    const bunDb = new BunDatabase(dbPath);
    bunDb.pragma = function (sql: string, options?: { simple?: boolean }): any {
      if (options?.simple) {
        const key = sql.trim();
        const row = bunDb.query(`PRAGMA ${key}`).get() as Record<string, unknown> | null;
        return row?.[key] ?? null;
      }
      bunDb.exec(`PRAGMA ${sql}`);
      return undefined;
    };
    return bunDb as Database.Database;
  }
  const BetterSqlite3 = _require('better-sqlite3');
  return new BetterSqlite3(dbPath) as Database.Database;
}
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
  metadata?: Record<string, unknown>;
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
  db = openSqliteDb(CLOISTER_DB_PATH);

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
export function writeHealthEventSync(event: Omit<HealthEvent, 'id'>): number {
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
 * Get health events for an agent within a time range
 *
 * @param agentId - Agent identifier
 * @param startTime - Start of time range (ISO 8601)
 * @param endTime - End of time range (ISO 8601)
 * @returns Array of health events, ordered by timestamp
 */
export function getHealthHistorySync(
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
export function getRecentHealthHistorySync(
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
export function getAllHealthHistorySync(
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
export function getLatestHealthEventSync(agentId: string): HealthEventWithMetadata | null {
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
export function getAgentsWithHistorySync(): string[] {
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
export function cleanupOldEventsSync(
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
export function deleteAgentHistorySync(agentId: string): number {
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// `better-sqlite3` (and `bun:sqlite`) are intentionally synchronous APIs, so
// these wrappers stay sync at the call site and lift failures into a typed
// `CloisterDatabaseError` channel via `Effect.try`. They exist so callers in
// the Effect world can compose health-history reads/writes without manually
// wrapping every call.

/** Effect variant of `writeHealthEvent`. */
export const writeHealthEvent = (
  event: Omit<HealthEvent, 'id'>,
): Effect.Effect<number, CloisterDatabaseError> =>
  Effect.try({
    try: () => writeHealthEventSync(event),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'writeHealthEvent',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `writeHealthEvents`. */
export const writeHealthEvents = (
  events: Omit<HealthEvent, 'id'>[],
): Effect.Effect<number, CloisterDatabaseError> =>
  Effect.try({
    try: () => writeHealthEventsSync(events),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'writeHealthEvents',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getHealthHistory`. */
export const getHealthHistory = (
  agentId: string,
  startTime: string,
  endTime: string,
): Effect.Effect<HealthEventWithMetadata[], CloisterDatabaseError> =>
  Effect.try({
    try: () => getHealthHistorySync(agentId, startTime, endTime),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'getHealthHistory',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getRecentHealthHistory`. */
export const getRecentHealthHistory = (
  agentId: string,
  limit?: number,
): Effect.Effect<HealthEventWithMetadata[], CloisterDatabaseError> =>
  Effect.try({
    try: () => getRecentHealthHistorySync(agentId, limit),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'getRecentHealthHistory',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getAllHealthHistory`. */
export const getAllHealthHistory = (
  startTime: string,
  endTime: string,
): Effect.Effect<HealthEventWithMetadata[], CloisterDatabaseError> =>
  Effect.try({
    try: () => getAllHealthHistorySync(startTime, endTime),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'getAllHealthHistory',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getLatestHealthEvent`. */
export const getLatestHealthEvent = (
  agentId: string,
): Effect.Effect<HealthEventWithMetadata | null, CloisterDatabaseError> =>
  Effect.try({
    try: () => getLatestHealthEventSync(agentId),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'getLatestHealthEvent',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getAgentsWithHistory`. */
export const getAgentsWithHistory = (): Effect.Effect<string[], CloisterDatabaseError> =>
  Effect.try({
    try: () => getAgentsWithHistorySync(),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'getAgentsWithHistory',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `cleanupOldEvents`. */
export const cleanupOldEvents = (
  retentionDays?: number,
): Effect.Effect<number, CloisterDatabaseError> =>
  Effect.try({
    try: () => cleanupOldEventsSync(getHealthDatabase(), retentionDays),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'cleanupOldEvents',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `deleteAgentHistory`. */
export const deleteAgentHistory = (
  agentId: string,
): Effect.Effect<number, CloisterDatabaseError> =>
  Effect.try({
    try: () => deleteAgentHistorySync(agentId),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'deleteAgentHistory',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getDatabaseStats`. */
export const getDatabaseStats = (): Effect.Effect<
  {
    totalEvents: number;
    uniqueAgents: number;
    oldestEvent: string | null;
    newestEvent: string | null;
  },
  CloisterDatabaseError
> =>
  Effect.try({
    try: () => getDatabaseStatsSync(),
    catch: (cause) =>
      new CloisterDatabaseError({
        operation: 'getDatabaseStats',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
