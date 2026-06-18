import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { ensureDiscoveredSessionsSchema } from '../../../lib/overdeck/discovered-sessions.js';

let TEST_HOME: string;
let odb: OverdeckTestDb;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-event-store-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  // setupOverdeckTestDb sets its own PANOPTICON_HOME; we override afterwards
  // to match the event-store home so both dbs share the same home.
  odb = setupOverdeckTestDb();
  // odb already set PANOPTICON_HOME to a temp dir; keep it.
});

afterEach(async () => {
  teardownOverdeckTestDb(odb);
  const { resetDatabase } = await import('../../../lib/database/index.js');
  resetDatabase();
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
  });
});
