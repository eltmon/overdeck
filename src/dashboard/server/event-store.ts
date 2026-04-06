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
 *   const store = await initEventStore();
 *   const seq = store.append({ type: 'agent.started', ... });
 *   const past = store.readFrom(0);
 *   const unsub = store.subscribe(event => console.log(event));
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPanopticonHome } from '../../lib/paths.js';
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
  /** Return the highest sequence number in the store (0 if empty). */
  getLatestSequence(): number;
}

// ─── Minimal DB interface (compatible with bun:sqlite and better-sqlite3) ────

interface PreparedStatement<R = Record<string, unknown>> {
  run(params?: Record<string, unknown>): { changes: number };
  get(params?: Record<string, unknown>): R | undefined | null;
  all(params?: Record<string, unknown>): R[];
}

export interface DbAdapter {
  prepare<R = Record<string, unknown>>(sql: string): PreparedStatement<R>;
  exec(sql: string): void;
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

// ─── Runtime-aware DB initializer ────────────────────────────────────────────

declare const Bun: unknown;

/**
 * Open the panopticon.db database using the appropriate driver for the runtime.
 * Under Bun: uses bun:sqlite (native, no native addons needed).
 * Under Node: uses the shared getDatabase() which applies migrations.
 */
export async function openEventDb(): Promise<DbAdapter> {
  const home = getPanopticonHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }
  const dbPath = join(home, 'panopticon.db');

  if (typeof Bun !== 'undefined') {
    const { Database } = await import('bun:sqlite');
    const db = new Database(dbPath, { create: true });
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA synchronous = NORMAL');
    // Ensure required tables exist (Bun doesn't run the shared schema migrations)
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
        type      TEXT    NOT NULL,
        timestamp TEXT    NOT NULL,
        payload   TEXT    NOT NULL DEFAULT '{}'
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS events_timestamp_idx ON events (timestamp)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS projection_cache (
        key        TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        sequence   INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    return db as unknown as DbAdapter;
  } else {
    // Node.js: use shared database connection — migrations run there
    const { getDatabase } = await import('../../lib/database/index.js');
    return getDatabase() as unknown as DbAdapter;
  }
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

  // Prepared statements for hot path performance
  // Use $name syntax — both better-sqlite3 and bun:sqlite require the sigil prefix
  // in the binding object when using named parameters. bun:sqlite does NOT accept
  // { name: value } for :name params (unlike better-sqlite3). $name style is
  // consistent across both runtimes.
  const insertStmt = db.prepare<void>(
    `INSERT INTO events (type, timestamp, payload) VALUES ($type, $timestamp, $payload)`,
  );
  const readFromStmt = db.prepare<EventRow>(
    `SELECT sequence, type, timestamp, payload FROM events WHERE sequence > $fromSequence ORDER BY sequence ASC`,
  );
  const compactStmt = db.prepare<void>(
    `DELETE FROM events WHERE timestamp < $cutoff`,
  );
  const latestSeqStmt = db.prepare<{ seq: number | null }>(
    `SELECT MAX(sequence) AS seq FROM events`,
  );
  const lastRowIdStmt = db.prepare<{ sequence: number }>(
    `SELECT last_insert_rowid() AS sequence`,
  );

  function append(event: Omit<DomainEvent, 'sequence'>): number {
    const timestamp =
      (event as Record<string, unknown>)['timestamp'] as string ?? new Date().toISOString();
    const payload = JSON.stringify((event as Record<string, unknown>)['payload'] ?? {});

    insertStmt.run({ $type: event.type, $timestamp: timestamp, $payload: payload });

    const row = lastRowIdStmt.get();
    const sequence = row?.sequence ?? 0;

    const stored: StoredEvent = {
      sequence,
      type: event.type,
      timestamp,
      payload: (event as Record<string, unknown>)['payload'] ?? {},
    };

    emitter.emit('event', stored);
    return sequence;
  }

  function readFrom(fromSequence: number): StoredEvent[] {
    const rows = readFromStmt.all({ $fromSequence: fromSequence });
    return rows.map(rowToStored);
  }

  function subscribe(fn: EventSubscriber): Unsubscribe {
    emitter.on('event', fn);
    return () => emitter.off('event', fn);
  }

  function compact(): void {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = compactStmt.run({ $cutoff: sevenDaysAgo });
    if (result.changes > 0) {
      console.log(`[event-store] Compacted ${result.changes} events older than 7 days`);
    }
  }

  function getLatestSequence(): number {
    const row = latestSeqStmt.get();
    return row?.seq ?? 0;
  }

  return { append, readFrom, subscribe, compact, getLatestSequence };
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
    _store = store;
    // Initialize projection cache with same DB connection
    import('./services/projection-cache.js').then(({ initProjectionCache }) => {
      initProjectionCache(db);
    }).catch(() => { /* module not available yet */ });
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
