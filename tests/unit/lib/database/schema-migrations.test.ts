import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema, runMigrations } from '../../../../src/lib/database/schema.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('schema migrations', () => {
  let db: Database.Database;
  let tempRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    tempRoot = mkdtempSync('/tmp/pan-schema-');
  });

  afterEach(() => {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('repairs stale session_file paths when the corrected transcript exists', () => {
    db.pragma('user_version = 15');
    db.exec(`
      CREATE TABLE conversations (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT NOT NULL UNIQUE,
        tmux_session     TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'active',
        cwd              TEXT NOT NULL,
        issue_id         TEXT,
        created_at       TEXT NOT NULL,
        ended_at         TEXT,
        last_attached_at TEXT,
        session_file     TEXT,
        title            TEXT,
        title_source     TEXT,
        title_seed       TEXT,
        total_cost       REAL DEFAULT 0,
        archived_at      TEXT,
        model            TEXT,
        effort           TEXT
      );
    `);

    const cwd = '/Users/edward.becker/Projects/panopticon-cli';
    const base = join(tempRoot, '.claude', 'projects');
    const stalePath = join(
      base,
      '-Users-edward.becker-Projects-panopticon-cli',
      'sessions',
      'session-1.jsonl'
    );
    const correctedPath = join(
      base,
      '-Users-edward-becker-Projects-panopticon-cli',
      'sessions',
      'session-1.jsonl'
    );
    mkdirSync(join(base, '-Users-edward-becker-Projects-panopticon-cli', 'sessions'), {
      recursive: true,
    });
    writeFileSync(correctedPath, '{"type":"message"}\n');

    db.prepare(
      `INSERT INTO conversations (name, tmux_session, status, cwd, created_at, session_file)
       VALUES (?, ?, 'active', ?, ?, ?)`
    ).run('conv-1', 'tmux-1', cwd, '2026-04-11T00:00:00.000Z', stalePath);

    runMigrations(db);

    const row = db
      .prepare(`SELECT session_file FROM conversations WHERE name = ?`)
      .get('conv-1') as { session_file: string };
    expect(row.session_file).toBe(correctedPath);
    expect(db.pragma('user_version', { simple: true })).toBe(22);
  });

  it('v16 → v17: creates favorites table and idx_favorites_type index', () => {
    // Start at v16 with a fully-initialised schema (minus favorites)
    initSchema(db);
    db.pragma('user_version = 16');
    // Drop the favorites table that initSchema created so we can verify the migration re-creates it
    db.exec('DROP TABLE IF EXISTS favorites');

    runMigrations(db);

    // favorites table must exist
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='favorites'`)
      .get() as { name: string } | undefined;
    expect(table?.name).toBe('favorites');

    // idx_favorites_type index must exist
    const index = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_favorites_type'`)
      .get() as { name: string } | undefined;
    expect(index?.name).toBe('idx_favorites_type');

    expect(db.pragma('user_version', { simple: true })).toBe(22);
  });

  // ── v21 → v22: reviewed_at_commit column (PAN-653) ──────────────────────────

  it('v21 → v22: adds reviewed_at_commit column to pre-PAN-653 review_status tables', () => {
    // Simulate a pre-PAN-653 database at v21: full schema minus reviewed_at_commit
    initSchema(db);
    db.pragma('user_version = 21');
    // Drop the column by recreating the table without it (SQLite has no DROP COLUMN in older versions,
    // but we can verify the migration adds it by starting from a table definition without it)
    db.exec(`
      CREATE TABLE review_status_v21 AS SELECT
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes, verification_cycle_count,
        verification_max_cycles, review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details
      FROM review_status;
      DROP TABLE review_status;
      ALTER TABLE review_status_v21 RENAME TO review_status;
    `);

    // Verify the column is absent before migration
    const colsBefore = db.pragma('table_info(review_status)') as Array<{ name: string }>;
    expect(colsBefore.map(c => c.name)).not.toContain('reviewed_at_commit');

    runMigrations(db);

    // After migration the column must exist
    const colsAfter = db.pragma('table_info(review_status)') as Array<{ name: string }>;
    expect(colsAfter.map(c => c.name)).toContain('reviewed_at_commit');
    expect(db.pragma('user_version', { simple: true })).toBe(22);
  });

  it('v21 → v22: can write and read reviewed_at_commit after migration', () => {
    initSchema(db);
    db.pragma('user_version = 21');
    // Strip reviewed_at_commit to simulate pre-migration DB
    db.exec(`
      CREATE TABLE review_status_v21 AS SELECT
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes, verification_cycle_count,
        verification_max_cycles, review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details
      FROM review_status;
      DROP TABLE review_status;
      ALTER TABLE review_status_v21 RENAME TO review_status;
    `);

    // Insert a pre-existing row (no reviewed_at_commit)
    db.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-MIGRATE-1', 'passed', 'passed', '2026-01-01T00:00:00.000Z', 0)
    `).run();

    runMigrations(db);

    // Should be able to write reviewed_at_commit to both new and existing rows
    const sha = 'abc1234567890abc1234567890abc1234567890';
    db.prepare(`UPDATE review_status SET reviewed_at_commit = ? WHERE issue_id = ?`).run(sha, 'PAN-MIGRATE-1');

    const row = db.prepare(`SELECT reviewed_at_commit FROM review_status WHERE issue_id = ?`).get('PAN-MIGRATE-1') as { reviewed_at_commit: string };
    expect(row.reviewed_at_commit).toBe(sha);
  });

  it('fresh initSchema includes reviewed_at_commit in review_status', () => {
    initSchema(db);
    const cols = db.pragma('table_info(review_status)') as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('reviewed_at_commit');
    expect(db.pragma('user_version', { simple: true })).toBe(22);
  });

  it('leaves session_file unchanged when the corrected transcript is missing', () => {
    db.pragma('user_version = 15');
    initSchema(db);
    db.pragma('user_version = 15');

    const cwd = '/Users/edward.becker/Projects/panopticon-cli';
    const stalePath = join(
      tempRoot,
      '.claude',
      'projects',
      '-Users-edward.becker-Projects-panopticon-cli',
      'sessions',
      'session-2.jsonl'
    );

    db.prepare(
      `INSERT INTO conversations (name, tmux_session, status, cwd, created_at, session_file)
       VALUES (?, ?, 'active', ?, ?, ?)`
    ).run('conv-2', 'tmux-2', cwd, '2026-04-11T00:00:00.000Z', stalePath);

    runMigrations(db);

    const row = db
      .prepare(`SELECT session_file FROM conversations WHERE name = ?`)
      .get('conv-2') as { session_file: string };
    expect(row.session_file).toBe(stalePath);
    expect(db.pragma('user_version', { simple: true })).toBe(22);
  });
});
