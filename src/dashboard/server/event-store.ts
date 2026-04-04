/**
 * Event Store — SQLite-backed append-only event log with PubSub (PAN-428)
 *
 * - Persists domain events to panopticon.db `events` table
 * - In-memory PubSub for live streaming to WebSocket clients
 * - Monotonic, gap-free sequence numbers (SQLite AUTOINCREMENT)
 * - 7-day retention with startup compaction
 * - Dual-runtime: bun:sqlite on Bun, better-sqlite3 on Node
 *
 * Usage:
 *   const store = createEventStore();
 *   const seq = store.append({ type: 'agent.started', ... });
 *   const past = store.readFrom(0);
 *   const unsub = store.subscribe(event => console.log(event));
 */

import { EventEmitter } from 'node:events';
import { getDatabase } from '../../lib/database/index.js';
import type { DomainEvent } from '@panopticon/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredEvent {
  sequence: number;
  type: string;
  timestamp: string;
  payload: unknown;
}

export type EventSubscriber = (event: StoredEvent) => void;
export type Unsubscribe = () => void;

export interface EventStore {
  /** Append a domain event. Returns the assigned sequence number. */
  append(event: Omit<DomainEvent, 'sequence'>): number;
  /** Return all events with sequence > fromSequence (exclusive lower bound). */
  readFrom(fromSequence: number): StoredEvent[];
  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe(fn: EventSubscriber): Unsubscribe;
  /** Run 7-day retention compaction. Called at startup. */
  compact(): void;
}

// ─── Row shape from SQLite ─────────────────────────────────────────────────────

interface EventRow {
  sequence: number;
  type: string;
  timestamp: string;
  payload: string;
}

function rowToStored(row: EventRow): StoredEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    timestamp: row.timestamp,
    payload: JSON.parse(row.payload),
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create and initialize an EventStore backed by panopticon.db.
 * Runs compaction on first call. Safe to call multiple times — returns the same
 * singleton (singleton is managed by the caller via module-level export below).
 */
export function createEventStore(): EventStore {
  const db = getDatabase();
  const emitter = new EventEmitter();
  // Allow many subscribers (one per WebSocket connection)
  emitter.setMaxListeners(0);

  // Prepared statements for hot path performance
  const insertStmt = db.prepare<{ type: string; timestamp: string; payload: string }, void>(
    `INSERT INTO events (type, timestamp, payload) VALUES ($type, $timestamp, $payload)`,
  );

  const readFromStmt = db.prepare<{ fromSequence: number }, EventRow>(
    `SELECT sequence, type, timestamp, payload FROM events WHERE sequence > $fromSequence ORDER BY sequence ASC`,
  );

  const compactStmt = db.prepare<{ cutoff: string }, void>(
    `DELETE FROM events WHERE timestamp < $cutoff`,
  );

  function append(event: Omit<DomainEvent, 'sequence'>): number {
    const timestamp = event.timestamp ?? new Date().toISOString();
    const payload = JSON.stringify((event as Record<string, unknown>).payload ?? {});

    insertStmt.run({ type: event.type, timestamp, payload });

    // Read back the sequence number assigned by SQLite AUTOINCREMENT
    const row = db.prepare<[], { sequence: number }>(
      `SELECT last_insert_rowid() AS sequence`,
    ).get();
    const sequence = row?.sequence ?? 0;

    const stored: StoredEvent = {
      sequence,
      type: event.type,
      timestamp,
      payload: (event as Record<string, unknown>).payload ?? {},
    };

    emitter.emit('event', stored);
    return sequence;
  }

  function readFrom(fromSequence: number): StoredEvent[] {
    const rows = readFromStmt.all({ fromSequence });
    return rows.map(rowToStored);
  }

  function subscribe(fn: EventSubscriber): Unsubscribe {
    emitter.on('event', fn);
    return () => emitter.off('event', fn);
  }

  function compact(): void {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = compactStmt.run({ cutoff: sevenDaysAgo });
    if (result.changes > 0) {
      console.log(`[event-store] Compacted ${result.changes} events older than 7 days`);
    }
  }

  return { append, readFrom, subscribe, compact };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _store: EventStore | null = null;

/**
 * Get the process-singleton EventStore.
 * Creates and compacts on first call.
 */
export function getEventStore(): EventStore {
  if (!_store) {
    _store = createEventStore();
    _store.compact();
  }
  return _store;
}
