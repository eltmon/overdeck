/**
 * Health Events SQLite Storage (panopticon.db)
 *
 * Provides the same function signatures as src/lib/cloister/database.ts but
 * stores events in health_events table within panopticon.db instead of
 * the separate cloister.db. This allows gradual migration — callers can
 * import from either module without changing call sites.
 *
 * PAN-1249: Effect migration pass — synchronous public API preserved so
 * existing call sites stay unchanged. SQLite operations are wrapped in
 * Effect.try with a local DatabaseError tag (failures still throw at the
 * boundary via Effect.runSync, matching prior behaviour). Full conversion
 * to @effect/sql-sqlite-bun is deferred to PAN-447.
 */

import { Data, Effect } from 'effect';
import { getDatabase } from './index.js';
import type { HealthState } from '../runtimes/types.js';

const RETENTION_DAYS = 7;

/** A SQLite operation against panopticon.db failed. */
class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

// ============== Types (re-exported to match cloister/database.ts) ==============

export interface HealthEvent {
  id?: number;
  agentId: string;
  timestamp: string;
  state: HealthState;
  previousState?: string;
  source?: string;
  metadata?: string;
}

export interface HealthEventWithMetadata extends Omit<HealthEvent, 'metadata'> {
  metadata?: Record<string, unknown>;
}

// ============== Write operations ==============

export function writeHealthEvent(event: Omit<HealthEvent, 'id'>): number {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const result = db.prepare(`
          INSERT INTO health_events (agent_id, timestamp, state, previous_state, source, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          event.agentId,
          event.timestamp,
          event.state,
          event.previousState ?? null,
          event.source ?? null,
          event.metadata ?? null,
        );
        return result.lastInsertRowid as number;
      },
      catch: (cause) => new DatabaseError({ operation: 'writeHealthEvent', cause }),
    }),
  );
}

export function writeHealthEvents(events: Omit<HealthEvent, 'id'>[]): number {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const insert = db.prepare(`
          INSERT INTO health_events (agent_id, timestamp, state, previous_state, source, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const insertMany = db.transaction((evs: Omit<HealthEvent, 'id'>[]) => {
          for (const ev of evs) {
            insert.run(ev.agentId, ev.timestamp, ev.state, ev.previousState ?? null, ev.source ?? null, ev.metadata ?? null);
          }
          return evs.length;
        });
        return insertMany(events);
      },
      catch: (cause) => new DatabaseError({ operation: 'writeHealthEvents', cause }),
    }),
  );
}

// ============== Read operations ==============

export function getHealthHistory(
  agentId: string,
  startTime: string,
  endTime: string,
): HealthEventWithMetadata[] {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
                 source, metadata
          FROM health_events
          WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC
        `).all(agentId, startTime, endTime) as HealthEvent[];
        return rows.map(parseMetadata);
      },
      catch: (cause) => new DatabaseError({ operation: 'getHealthHistory', cause }),
    }),
  );
}

export function getRecentHealthHistory(agentId: string, limit = 100): HealthEventWithMetadata[] {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
                 source, metadata
          FROM health_events
          WHERE agent_id = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).all(agentId, limit) as HealthEvent[];
        return rows.map(parseMetadata).reverse();
      },
      catch: (cause) => new DatabaseError({ operation: 'getRecentHealthHistory', cause }),
    }),
  );
}

export function getAllHealthHistory(startTime: string, endTime: string): HealthEventWithMetadata[] {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
                 source, metadata
          FROM health_events
          WHERE timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC
        `).all(startTime, endTime) as HealthEvent[];
        return rows.map(parseMetadata);
      },
      catch: (cause) => new DatabaseError({ operation: 'getAllHealthHistory', cause }),
    }),
  );
}

export function getLatestHealthEvent(agentId: string): HealthEventWithMetadata | null {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const row = db.prepare(`
          SELECT id, agent_id as agentId, timestamp, state, previous_state as previousState,
                 source, metadata
          FROM health_events
          WHERE agent_id = ?
          ORDER BY timestamp DESC
          LIMIT 1
        `).get(agentId) as HealthEvent | undefined;
        return row ? parseMetadata(row) : null;
      },
      catch: (cause) => new DatabaseError({ operation: 'getLatestHealthEvent', cause }),
    }),
  );
}

export function getAgentsWithHistory(): string[] {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const results = db.prepare(`
          SELECT DISTINCT agent_id as agentId FROM health_events ORDER BY agent_id ASC
        `).all() as { agentId: string }[];
        return results.map(r => r.agentId);
      },
      catch: (cause) => new DatabaseError({ operation: 'getAgentsWithHistory', cause }),
    }),
  );
}

// ============== Maintenance ==============

export function cleanupOldHealthEvents(retentionDays = RETENTION_DAYS): number {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);
        const result = db.prepare(
          'DELETE FROM health_events WHERE timestamp < ?'
        ).run(cutoff.toISOString());
        return result.changes;
      },
      catch: (cause) => new DatabaseError({ operation: 'cleanupOldHealthEvents', cause }),
    }),
  );
}

export function deleteAgentHealthHistory(agentId: string): number {
  return Effect.runSync(
    Effect.try({
      try: () => {
        const db = getDatabase();
        const result = db.prepare('DELETE FROM health_events WHERE agent_id = ?').run(agentId);
        return result.changes;
      },
      catch: (cause) => new DatabaseError({ operation: 'deleteAgentHealthHistory', cause }),
    }),
  );
}

// ============== Helpers ==============

function parseMetadata(event: HealthEvent): HealthEventWithMetadata {
  return {
    ...event,
    metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
  };
}
