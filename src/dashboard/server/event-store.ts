/**
 * Event Store — SQLite-backed append-only event log with PubSub (PAN-428)
 *
 * - Persists domain events to overdeck.db `events` table
 * - In-memory PubSub for live streaming to WebSocket clients
 * - Monotonic, gap-free sequence numbers (SQLite AUTOINCREMENT)
 * - 7-day retention with startup compaction
 * - Shared SQLite driver adapter (bun:sqlite on Bun, node:sqlite on Node)
 *
 * Usage:
 *   const store = await initEventStore();
 *   const seq = store.append({ type: 'agent.started', ... });
 *   const past = store.readFrom(0);
 *   const unsub = store.subscribe(event => console.log(event));
 */

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { getOverdeckHome } from '../../lib/paths.js';
import { setActivityEventStoreProvider } from '../../lib/activity-logger.js';
import { getOverdeckDatabasePath } from '../../lib/overdeck/paths.js';
import { getOverdeckDatabaseSync } from '../../lib/overdeck/infra.js';
import type { DomainEvent } from '@overdeck/contracts';

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
  /**
   * Async append — queues the event and flushes to SQLite in the next
   * microtask batch. Use from server-reachable code to avoid blocking
   * the event loop on every event. The event is emitted to subscribers
   * immediately; persistence happens asynchronously.
   */
  appendAsync(event: Omit<DomainEvent, 'sequence'>): Promise<number>;
  /**
   * Emit an event to in-memory subscribers ONLY — no SQLite persistence.
   * Use for high-frequency derived events (e.g. issues.snapshot) that are
   * too large to accumulate in the event log but still need live fan-out.
   */
  emitOnly(event: Omit<DomainEvent, 'sequence'>): void;
  /** Return all events with sequence > fromSequence (exclusive lower bound). */
  readFrom(fromSequence: number): StoredEvent[];
  /** Return events of a given type, most recent first, capped at limit. */
  queryByType(type: string, limit?: number): StoredEvent[];
  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe(fn: EventSubscriber): Unsubscribe;
  /** Run 7-day retention compaction. Called at startup. */
  compact(): void;
  /**
   * Purge all rows of a given event type. Used at startup to clean up
   * oversized event types that were mistakenly persisted (e.g. issues.snapshot).
   */
  purgeType(type: string): number;
  /** Return the highest sequence number in the store (0 if empty). */
  getLatestSequence(): number;
  /**
   * Emit an already-persisted event to in-memory subscribers without writing
   * to SQLite. Used by transactional projections that insert the row inside
   * their own transaction and then notify listeners after commit.
   */
  emitStored(event: StoredEvent): void;
}

// ─── Minimal DB interface (compatible with the shared SQLite driver) ─────────
//
// Uses positional parameters (?) in all SQL to avoid runtime differences in
// named-parameter binding syntax. Positional parameters + arrays work through
// the shared adapter in both runtimes.

interface PreparedStatement<R = Record<string, unknown>> {
  run(params?: unknown[]): { changes: number };
  get(params?: unknown[]): R | undefined | null;
  all(params?: unknown[]): R[];
}

export interface DbAdapter {
  prepare<R = Record<string, unknown>>(sql: string): PreparedStatement<R>;
  exec(sql: string): void;
}

// ─── Row shape from SQLite ─────────────────────────────────────────────────────

interface EventRow {
  sequence: number;
  type: string;
  timestamp: number;
  payload: string;
}

function rowToStored(row: EventRow): StoredEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    timestamp: new Date(row.timestamp).toISOString(),
    payload: JSON.parse(row.payload),
  };
}

function eventTimestampMillis(event: Omit<DomainEvent, 'sequence'>): number {
  const raw = (event as Record<string, unknown>)['timestamp'];
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return Date.parse(raw);
  return Date.now();
}

// ─── Runtime-aware DB initializer ────────────────────────────────────────────

/**
 * Open the overdeck.db database using the appropriate driver for the runtime.
 * The shared overdeck opener applies migrations and delegates runtime-specific
 * SQLite driver selection to src/lib/database/driver.ts.
 */
export async function openEventDb(): Promise<DbAdapter> {
  const home = getOverdeckHome();
  if (!existsSync(home)) {
    await mkdir(home, { recursive: true });
  }
  const dbPath = getOverdeckDatabasePath();

  // Open overdeck.db through the shared overdeck opener so the hand-maintained
  // migration owns the events table and indexes.
  const db = getOverdeckDatabaseSync(dbPath);
  return db as unknown as DbAdapter;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an EventStore from a pre-opened DbAdapter.
 * Call openEventDb() first to get the adapter.
 */
export function createEventStore(db: DbAdapter): EventStore {
  const emitter = new EventEmitter();
  // Allow many subscribers (one per WebSocket connection)
  emitter.setMaxListeners(0);

  // Prepared statements for hot path performance.
  // All SQL uses positional parameters (?) via shared-adapter array binding.
  const insertStmt = db.prepare<void>(
    `INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`,
  );
  const readFromStmt = db.prepare<EventRow>(
    // Exclude event types with oversized payloads that would OOM the server on replay.
    // issues.snapshot is a high-frequency derived event (~1.5 MB each) that is not
    // useful for replay — clients get current issues via getSnapshot instead.
    `SELECT sequence, type, timestamp, payload FROM events WHERE sequence > ? AND type != 'issues.snapshot' ORDER BY sequence ASC`,
  );
  const compactStmt = db.prepare<void>(
    `DELETE FROM events WHERE timestamp < ?`,
  );
  const latestSeqStmt = db.prepare<{ seq: number | null }>(
    `SELECT MAX(sequence) AS seq FROM events`,
  );
  const lastRowIdStmt = db.prepare<{ sequence: number }>(
    `SELECT last_insert_rowid() AS sequence`,
  );
  const queryByTypeStmt = db.prepare<EventRow>(
    `SELECT sequence, type, timestamp, payload FROM events WHERE type = ? ORDER BY sequence DESC LIMIT ?`,
  );
  const purgeTypeStmt = db.prepare<void>(
    `DELETE FROM events WHERE type = ?`,
  );

  // ─── Async write queue ───────────────────────────────────────────────────────
  // Batches events and flushes them in a single transaction on the next tick.
  // This prevents individual SQLite INSERTs from blocking the event loop
  // when high-frequency callers (e.g. enrichment poller) emit many events.
  interface QueuedEvent {
    type: string;
    timestamp: number;
    payload: string;
    rawPayload: unknown;
    resolve: (seq: number) => void;
  }
  let writeQueue: QueuedEvent[] = [];
  let flushScheduled = false;
  let inMemorySequence = 0;

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(() => {
      flushScheduled = false;
      if (writeQueue.length === 0) return;
      const batch = writeQueue;
      writeQueue = [];

      // Get current max sequence for in-memory numbering
      const latestRow = latestSeqStmt.get();
      let nextSeq = (latestRow?.seq ?? 0) + 1;

      // Batch insert all events in a single transaction
      try {
        db.exec('BEGIN IMMEDIATE');
        for (const q of batch) {
          insertStmt.run([q.type, q.timestamp, q.payload]);
        }
        db.exec('COMMIT');
      } catch (err) {
        // Best-effort rollback. If BEGIN IMMEDIATE itself failed (e.g. the DB
        // was busy/locked), no transaction is active and an unconditional
        // ROLLBACK throws "cannot rollback - no transaction is active". Because
        // this runs inside a setTimeout, that throw is uncaught and crashes the
        // whole dashboard. A failed batch flush must only reject + log, never
        // take the process down. Mirrors the guard in agent-projection.ts.
        try { db.exec('ROLLBACK'); } catch { /* no active transaction — nothing to roll back */ }
        // Reject all pending promises
        for (const q of batch) {
          q.resolve(0);
        }
        console.error('[event-store] Batch write failed:', err);
        return;
      }

      // Emit events and resolve promises with sequence numbers
      for (const q of batch) {
        const stored: StoredEvent = {
          sequence: nextSeq,
          type: q.type,
          timestamp: new Date(q.timestamp).toISOString(),
          payload: q.rawPayload,
        };
        emitter.emit('event', stored);
        q.resolve(nextSeq);
        nextSeq++;
      }
    }, 0);
  }

  function append(event: Omit<DomainEvent, 'sequence'>): number {
    const timestamp = eventTimestampMillis(event);
    const payload = JSON.stringify((event as Record<string, unknown>)['payload'] ?? {});

    insertStmt.run([event.type, timestamp, payload]);

    const row = lastRowIdStmt.get();
    const sequence = row?.sequence ?? 0;

    const stored: StoredEvent = {
      sequence,
      type: event.type,
      timestamp: new Date(timestamp).toISOString(),
      payload: (event as Record<string, unknown>)['payload'] ?? {},
    };

    emitter.emit('event', stored);
    return sequence;
  }

  function appendAsync(event: Omit<DomainEvent, 'sequence'>): Promise<number> {
    return new Promise((resolve) => {
      const timestamp = eventTimestampMillis(event);
      const payload = JSON.stringify((event as Record<string, unknown>)['payload'] ?? {});

      writeQueue.push({
        type: event.type,
        timestamp,
        payload,
        rawPayload: (event as Record<string, unknown>)['payload'] ?? {},
        resolve,
      });

      scheduleFlush();
    });
  }

  function emitOnly(event: Omit<DomainEvent, 'sequence'>): void {
    const timestamp = eventTimestampMillis(event);
    const stored: StoredEvent = {
      sequence: -1, // sentinel: in-memory only, not persisted
      type: event.type,
      timestamp: new Date(timestamp).toISOString(),
      payload: (event as Record<string, unknown>)['payload'] ?? {},
    };
    emitter.emit('event', stored);
  }

  function readFrom(fromSequence: number): StoredEvent[] {
    const rows = readFromStmt.all([fromSequence]);
    return rows.map(rowToStored);
  }

  function subscribe(fn: EventSubscriber): Unsubscribe {
    emitter.on('event', fn);
    return () => emitter.off('event', fn);
  }

  function compact(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const result = compactStmt.run([sevenDaysAgo]);
    if (result.changes > 0) {
      console.log(`[event-store] Compacted ${result.changes} events older than 7 days`);
    }
  }

  function purgeType(type: string): number {
    const result = purgeTypeStmt.run([type]);
    return result.changes;
  }

  function getLatestSequence(): number {
    const row = latestSeqStmt.get();
    return row?.seq ?? 0;
  }

  function queryByType(type: string, limit = 100): StoredEvent[] {
    const rows = queryByTypeStmt.all([type, limit]);
    // Return most-recent-first (ORDER BY sequence DESC)
    return rows.map(rowToStored).reverse();
  }

  function emitStored(event: StoredEvent): void {
    emitter.emit('event', event);
  }

  return { append, appendAsync, emitOnly, readFrom, queryByType, subscribe, compact, purgeType, getLatestSequence, emitStored };
}

// ─── Module-level singleton ───────────────────────────────────────────────────

let _store: EventStore | null = null;
let _db: DbAdapter | null = null;
let _initPromise: Promise<EventStore> | null = null;

/**
 * Initialize and return the process-singleton EventStore (async, Bun-compatible).
 * Idempotent — returns the same store on subsequent calls.
 */
export async function initEventStore(): Promise<EventStore> {
  if (_store) return _store;
  if (_initPromise) return _initPromise;

  _initPromise = openEventDb().then((db) => {
    _db = db;
    const store = createEventStore(db);
    store.compact();
    // One-time migration: purge issues.snapshot rows that were mistakenly persisted
    // in older versions. Each row is ~1.5 MB; thousands of them cause startup OOM.
    // Safe to run unconditionally — purgeType is a no-op if no rows exist.
    const purged = store.purgeType('issues.snapshot');
    if (purged > 0) {
      console.log(`[event-store] Purged ${purged} oversized issues.snapshot events from persistent store`);
    }

    // One-time migration: purge agent.output_received rows that were persisted
    // before the poller switched to emitOnly. Terminal output is ephemeral and
    // reconstructable from tmux, so these rows are safe to delete.
    const purgedOutput = store.purgeType('agent.output_received');
    if (purgedOutput > 0) {
      console.log(`[event-store] Purged ${purgedOutput} agent.output_received events from persistent store`);
      try {
        db.exec('PRAGMA incremental_vacuum');
      } catch (err) {
        // Non-fatal: the 15-minute periodic reclaimer in src/lib/database/index.ts
        // is the backstop for returning freed pages to the OS.
        console.error('[event-store] incremental_vacuum failed (non-fatal):', err);
      }
    }

    _store = store;
    setActivityEventStoreProvider(() => store);
    return store;
  });

  return _initPromise;
}

/**
 * Return the shared DbAdapter after initEventStore() has resolved.
 * Used by services that need access to the same DB connection.
 */
export function getSharedDb(): DbAdapter {
  if (!_db) {
    throw new Error('[event-store] getSharedDb() called before initEventStore() resolved.');
  }
  return _db;
}

/**
 * Synchronous accessor — returns the store if already initialized, throws otherwise.
 * Used by legacy callers that expect a sync API (event-store unit tests, etc.)
 */
export function getEventStore(): EventStore {
  if (!_store) {
    throw new Error(
      '[event-store] getEventStore() called before initEventStore() resolved. ' +
      'Use initEventStore() for async initialization.',
    );
  }
  return _store;
}
