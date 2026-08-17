import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type SqliteDatabase } from '../../database/driver.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
  OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS,
} from '../infra.js';
import { OVERDECK_MIGRATION_PATH, OVERDECK_TABLE_COUNT } from '../paths.js';
import {
  auditOverdeckSchemaSync,
  readOverdeckSchemaExpectationsSync,
} from '../schema-audit.js';

let tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-schema-audit-'));
  tempDirs.push(dir);
  return join(dir, 'overdeck.db');
}

function createInitializedDatabase(dbPath = makeDbPath()): SqliteDatabase {
  const db = openDatabase(dbPath);
  const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
  return db;
}

function removeExpectedArtifacts(db: SqliteDatabase): void {
  db.exec('DROP INDEX `events_type_ts_idx`');
  db.exec('ALTER TABLE `agents` DROP COLUMN `phase`');
}

afterEach(() => {
  closeOverdeckDatabaseSync();
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck schema audit', () => {
  it('parses at least the declared table count from the real migration', () => {
    const expected = readOverdeckSchemaExpectationsSync(
      OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS,
    );

    expect(expected.tables.size).toBeGreaterThanOrEqual(OVERDECK_TABLE_COUNT);
    expect(expected.tables.get('agents')).toContain('yielded_by_scheduler');
    expect(expected.indexes).toContain('idx_cost_agent_id');
    expect(expected.indexes).toContain('idx_cost_issue_upper');
  });

  it('reports exactly one missing index and column', () => {
    const db = createInitializedDatabase();
    try {
      removeExpectedArtifacts(db);

      expect(
        auditOverdeckSchemaSync(db, OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS),
      ).toEqual({
        missingTables: [],
        missingIndexes: ['events_type_ts_idx'],
        missingColumns: [{ table: 'agents', column: 'phase' }],
      });
    } finally {
      db.close();
    }
  });

  it('ignores extra tables and columns and succeeds in query-only mode', () => {
    const db = createInitializedDatabase();
    try {
      db.exec('CREATE TABLE `schema_audit_extra` (`id` integer)');
      db.exec('ALTER TABLE `agents` ADD COLUMN `schema_audit_extra` text');
      db.pragma('query_only = ON');

      expect(
        auditOverdeckSchemaSync(db, OVERDECK_SCHEMA_TOP_UP_EXPECTATIONS),
      ).toEqual({
        missingTables: [],
        missingIndexes: [],
        missingColumns: [],
      });
    } finally {
      db.close();
    }
  });

  it('warns for each missing artifact at startup without repairing the schema', () => {
    const dbPath = makeDbPath();
    const setup = createInitializedDatabase(dbPath);
    setup.exec(`
      CREATE TABLE cost_reconcile_file_state (
        path TEXT PRIMARY KEY NOT NULL,
        mtime_ms INTEGER NOT NULL,
        size INTEGER NOT NULL,
        verdict TEXT NOT NULL
      )
    `);
    removeExpectedArtifacts(setup);
    const schemaVersion = setup.pragma('schema_version', { simple: true });
    setup.close();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const opened = getOverdeckDatabaseSync(dbPath);

    expect(warnSpy.mock.calls.map((call) => call.join(' '))).toEqual([
      '[schema-audit] missing index: events_type_ts_idx',
      '[schema-audit] missing column: agents.phase',
    ]);
    expect(opened.pragma('schema_version', { simple: true })).toBe(schemaVersion);
    expect(
      opened
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'events_type_ts_idx'")
        .get(),
    ).toBeUndefined();
    expect(
      opened
        .prepare('PRAGMA table_info(`agents`)')
        .all<{ name: string }>()
        .map((column) => column.name),
    ).not.toContain('phase');
  });

  it('opens a current schema read-only without executing DDL or DML', () => {
    const dbPath = makeDbPath();
    createInitializedDatabase(dbPath).close();
    const db = getOverdeckDatabaseSync(dbPath, { readOnly: true });

    expect(db.prepare('SELECT COUNT(*) AS count FROM agents').get()).toEqual({ count: 0 });
    expect(() => db.exec('UPDATE agents SET status = status')).toThrow(/read.?only/i);
  });

  it('fails read-only opens with a clear compatibility error when schema is stale', () => {
    const dbPath = makeDbPath();
    const setup = createInitializedDatabase(dbPath);
    setup.exec('DROP INDEX `idx_cost_agent_id`');
    setup.close();

    expect(() => getOverdeckDatabaseSync(dbPath, { readOnly: true })).toThrow(
      /schema is incompatible.*index idx_cost_agent_id/i,
    );
  });
});
