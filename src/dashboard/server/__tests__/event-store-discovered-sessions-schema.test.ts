import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import {
  ensureDiscoveredSessionsSchema,
  findDiscoveredSessions,
  upsertDiscoveredSession,
} from '../../../lib/overdeck/discovered-sessions.js';
import { openDatabase } from '../../../lib/database/driver.js';
import { runMigrations } from '../../../lib/database/schema.js';
import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../../../lib/overdeck/infra.js';

let TEST_HOME: string;
let odb: OverdeckTestDb;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-event-store-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  // setupOverdeckTestDb sets its own OVERDECK_HOME; we override afterwards
  // to match the event-store home so both dbs share the same home.
  odb = setupOverdeckTestDb();
  // odb already set OVERDECK_HOME to a temp dir; keep it.
});

afterEach(async () => {
  teardownOverdeckTestDb(odb);
  const { closeOverdeckDatabaseSync } = await import('../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('event-store database startup schema', () => {
  it('opens the event-store database with events table and overdeck.db with discovered-session tables', async () => {
    // event-store now opens overdeck.db, so events and discovered-session tables
    // live in the same migrated database.
    const { openEventDb } = await import('../event-store.js');
    const eventDb = await openEventDb();
    const eventTables = eventDb
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')`)
      .all() as Array<{ name: string }>;
    const eventTableNames = eventTables.map((t) => t.name);
    expect(eventTableNames).toContain('events');
    expect(eventTableNames).toContain('discovered_sessions');

    // overdeck.db — should have discovered_sessions, sessions_fts, session_embeddings
    // ensureDiscoveredSessionsSchema() creates the FTS virtual tables (not in migration SQL).
    ensureDiscoveredSessionsSchema();
    const overdeckDb = odb.raw();
    const overdeckTables = overdeckDb
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')`)
      .all() as Array<{ name: string }>;
    const overdeckTableNames = overdeckTables.map((t) => t.name);
    expect(overdeckTableNames).toContain('discovered_sessions');
    expect(overdeckTableNames).toContain('sessions_fts');
    expect(overdeckTableNames).toContain('session_embeddings');

    const columns = overdeckDb.prepare(`PRAGMA table_info(discovered_sessions)`).all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('harness');
  });

  it('migrates v57 discovered_sessions rows by adding and backfilling harness idempotently', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec(`
        CREATE TABLE discovered_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jsonl_path TEXT NOT NULL UNIQUE,
          scanned_at TEXT NOT NULL
        );
        INSERT INTO discovered_sessions (jsonl_path, scanned_at)
        VALUES ('/legacy/claude.jsonl', '2026-07-02T00:00:00.000Z');
      `);
      db.pragma('user_version = 57');

      runMigrations(db);
      runMigrations(db);

      const row = db
        .prepare(`SELECT harness FROM discovered_sessions WHERE jsonl_path = ?`)
        .get('/legacy/claude.jsonl') as { harness: string };
      expect(row.harness).toBe('claude-code');
    } finally {
      db.close();
    }
  });

  it('round-trips discovered session harness through the overdeck data layer', () => {
    const inserted = upsertDiscoveredSession({
      jsonlPath: '/sessions/ohmypi.jsonl',
      harness: 'ohmypi',
      sessionId: 'ohmypi-session',
      messageCount: 1,
    });

    expect(inserted.harness).toBe('ohmypi');
    expect(findDiscoveredSessions().find((session) => session.jsonlPath === '/sessions/ohmypi.jsonl')?.harness)
      .toBe('ohmypi');
  });

  it('top-ups existing overdeck databases with discovered session harness', () => {
    const dbPath = join(TEST_HOME, 'existing-overdeck.db');
    const seedDb = openDatabase(dbPath);
    try {
      seedDb.exec(`
        CREATE TABLE agents (id TEXT PRIMARY KEY);
        CREATE TABLE cost_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT);
        CREATE TABLE discovered_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jsonl_path TEXT NOT NULL UNIQUE,
          scanned_at INTEGER NOT NULL
        );
        INSERT INTO discovered_sessions (jsonl_path, scanned_at)
        VALUES ('/legacy/existing.jsonl', 1782950400000);
      `);
    } finally {
      seedDb.close();
    }

    const db = getOverdeckDatabaseSync(dbPath);
    const row = db
      .prepare(`SELECT harness FROM discovered_sessions WHERE jsonl_path = ?`)
      .get('/legacy/existing.jsonl') as { harness: string };

    expect(row.harness).toBe('claude-code');
    closeOverdeckDatabaseSync();
  });
});
