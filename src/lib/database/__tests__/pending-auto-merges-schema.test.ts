import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { resetDatabase, getDatabase } from '../index.js';
import { runMigrations, SCHEMA_VERSION } from '../schema.js';

let testHome: string | undefined;

afterEach(() => {
  resetDatabase();
  delete process.env.PANOPTICON_HOME;
  if (testHome) rmSync(testHome, { recursive: true, force: true });
  testHome = undefined;
});

function makeTestHome(prefix: string): string {
  testHome = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.PANOPTICON_HOME = testHome;
  return testHome;
}

describe('pending auto-merges schema', () => {
  it('uses current schema version and creates pending_auto_merges on fresh init', () => {
    makeTestHome('pan-pending-auto-merges-fresh');

    expect(SCHEMA_VERSION).toBe(46);
    const db = getDatabase();
    expect(db.pragma('user_version', { simple: true })).toBe(46);

    const columns = db.prepare('PRAGMA table_info(pending_auto_merges)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'issueId',
      'prUrl',
      'prNumber',
      'projectKey',
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

  it('migrates an existing v44 database by adding auto-merge hot-path indexes', () => {
    const home = makeTestHome('pan-pending-auto-merges-v44-indexes');
    const db = new Database(join(home, 'panopticon.db'));
    try {
      db.exec(`
        CREATE TABLE pending_auto_merges (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          issueId          TEXT NOT NULL,
          prUrl            TEXT NOT NULL,
          prNumber         INTEGER,
          projectKey       TEXT NOT NULL,
          "status"         TEXT NOT NULL CHECK ("status" IN ('pending','merging','blocked','failed','merged','cancelled')),
          scheduledMergeAt TEXT NOT NULL,
          scheduledAt      TEXT NOT NULL,
          mergedAt         TEXT,
          failureReason    TEXT,
          cancelledAt      TEXT,
          cancelledBy      TEXT
        );
        CREATE UNIQUE INDEX idx_pending_auto_merges_active_issue
          ON pending_auto_merges(issueId) WHERE "status" IN ('pending','merging');
        PRAGMA user_version = 44;
      `);

      runMigrations(db);

      expect(db.pragma('user_version', { simple: true })).toBe(46);
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
    const db = new Database(join(home, 'panopticon.db'));
    try {
      db.exec(`
        CREATE TABLE app_settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO app_settings (key, value, updated_at)
          VALUES ('sentinel', 'kept', '2026-05-25T09:00:00.000Z');
        PRAGMA user_version = 43;
      `);

      runMigrations(db);

      expect(db.pragma('user_version', { simple: true })).toBe(46);
      expect(db.prepare("SELECT value FROM app_settings WHERE key = 'sentinel'").get()).toEqual({ value: 'kept' });
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_auto_merges'").get();
      expect(table).toEqual({ name: 'pending_auto_merges' });
    } finally {
      db.close();
    }
  });
});
