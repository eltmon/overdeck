import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type SqliteDatabase } from '../driver.js';
import { resetDatabase, getDatabase } from '../index.js';
import { runMigrations, SCHEMA_VERSION } from '../schema.js';

let testHome: string | undefined;

afterEach(() => {
  resetDatabase();
  delete process.env.OVERDECK_HOME;
  if (testHome) rmSync(testHome, { recursive: true, force: true });
  testHome = undefined;
});

function makeTestHome(prefix: string): string {
  testHome = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
  return testHome;
}

function initializeCurrentSchema(db: SqliteDatabase): void {
  runMigrations(db);
}

describe('pending auto-merges schema', { timeout: 30_000 }, () => {
  it('uses current schema version and creates pending_auto_merges on fresh init', () => {
    makeTestHome('pan-pending-auto-merges-fresh');

    expect(SCHEMA_VERSION).toBe(62);
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

    const columns = db.prepare('PRAGMA table_info(pending_auto_merges)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'issueId',
      'prUrl',
      'prNumber',
      'projectKey',
      'forge',
      'status',
      'scheduledMergeAt',
      'scheduledAt',
      'mergedAt',
      'failureReason',
      'cancelledAt',
      'cancelledBy',
    ]);

    const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending_auto_merges'").all() as Array<{ name: string; sql: string }>;
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'idx_pending_auto_merges_active_issue',
        sql: expect.stringContaining('WHERE "status" IN (\'pending\',\'merging\')'),
      }),
      expect.objectContaining({ name: 'idx_pending_auto_merges_due_pending' }),
      expect.objectContaining({ name: 'idx_pending_auto_merges_actionable_issue' }),
      expect.objectContaining({ name: 'idx_pending_auto_merges_actionable_schedule' }),
    ]));
  });

  it('creates indexed event access paths for flywheel stats', () => {
    makeTestHome('pan-events-stats-indexes-fresh');

    const db = getDatabase();
    const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all() as Array<{ name: string; sql: string }>;

    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'idx_events_issue_type_timestamp_sequence',
        sql: expect.stringContaining("json_extract(payload, '$.issueId'), type, timestamp, sequence"),
      }),
      expect.objectContaining({
        name: 'idx_events_type_timestamp_issue_sequence',
        sql: expect.stringContaining("type, timestamp, json_extract(payload, '$.issueId'), sequence"),
      }),
    ]));
  });

  it('migrates an existing v46 database by adding flywheel stats event indexes', () => {
    const home = makeTestHome('pan-events-stats-indexes-migrate');
    const db = openDatabase(join(home, 'panopticon.db'));
    try {
      initializeCurrentSchema(db);
      db.exec(`
        DROP INDEX idx_events_issue_type_timestamp_sequence;
        DROP INDEX idx_events_type_timestamp_issue_sequence;
        PRAGMA user_version = 46;
      `);

      runMigrations(db);

      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all() as Array<{ name: string }>;
      expect(indexes).toEqual(expect.arrayContaining([
        { name: 'idx_events_issue_type_timestamp_sequence' },
        { name: 'idx_events_type_timestamp_issue_sequence' },
      ]));
    } finally {
      db.close();
    }
  });

  it('migrates an existing v44 database by adding auto-merge hot-path indexes', () => {
    const home = makeTestHome('pan-pending-auto-merges-v44-indexes');
    const db = openDatabase(join(home, 'panopticon.db'));
    try {
      initializeCurrentSchema(db);
      db.exec(`
        DROP INDEX idx_pending_auto_merges_due_pending;
        DROP INDEX idx_pending_auto_merges_actionable_issue;
        DROP INDEX idx_pending_auto_merges_actionable_schedule;
        PRAGMA user_version = 44;
      `);

      runMigrations(db);

      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending_auto_merges'").all() as Array<{ name: string }>;
      expect(indexes).toEqual(expect.arrayContaining([
        { name: 'idx_pending_auto_merges_due_pending' },
        { name: 'idx_pending_auto_merges_actionable_issue' },
        { name: 'idx_pending_auto_merges_actionable_schedule' },
      ]));
    } finally {
      db.close();
    }
  });

  it('migrates an existing v43 database without dropping existing data', () => {
    const home = makeTestHome('pan-pending-auto-merges-migrate');
    const db = openDatabase(join(home, 'panopticon.db'));
    try {
      initializeCurrentSchema(db);
      db.exec(`
        DROP TABLE pending_auto_merges;
        INSERT INTO app_settings (key, value, updated_at)
          VALUES ('sentinel', 'kept', '2026-05-25T09:00:00.000Z');
        PRAGMA user_version = 43;
      `);

      runMigrations(db);

      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      expect(db.prepare("SELECT value FROM app_settings WHERE key = 'sentinel'").get()).toEqual({ value: 'kept' });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_auto_merges'").get();
      expect(table).toEqual({ name: 'pending_auto_merges' });
    } finally {
      db.close();
    }
  });
});
