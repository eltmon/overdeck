import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { SCHEMA_VERSION, initSchema, runMigrations } from '../../../../src/lib/database/schema.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

describe('schema migrations', () => {
  let db: SqliteDatabase;
  let tempRoot: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    tempRoot = mkdtempSync('/tmp/pan-schema-');
  });

  afterEach(() => {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('preserves user_version when the database is newer than this build', () => {
    const newerVersion = SCHEMA_VERSION + 1;
    db.pragma(`user_version = ${newerVersion}`);

    runMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(newerVersion);
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

    const cwd = '/Users/edward.becker/Projects/overdeck';
    const base = join(tempRoot, '.claude', 'projects');
    const stalePath = join(
      base,
      '-Users-edward.becker-Projects-overdeck',
      'sessions',
      'session-1.jsonl'
    );
    const correctedPath = join(
      base,
      '-Users-edward-becker-Projects-overdeck',
      'sessions',
      'session-1.jsonl'
    );
    mkdirSync(join(base, '-Users-edward-becker-Projects-overdeck', 'sessions'), {
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
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
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

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
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
    const colsBefore = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    expect(colsBefore.map(c => c.name)).not.toContain('reviewed_at_commit');

    runMigrations(db);

    // After migration the column must exist
    const colsAfter = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    expect(colsAfter.map(c => c.name)).toContain('reviewed_at_commit');
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
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

  it('fresh initSchema includes reviewed_at_commit and merge_retry_count in review_status', () => {
    initSchema(db);
    const cols = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    const names = cols.map(c => c.name);
    expect(names).toContain('reviewed_at_commit');
    expect(names).toContain('merge_retry_count');
    expect(names).toContain('pr_head_sha');
    expect(names).toContain('pr_number');
    expect(names).toContain('conflict_resolution_dispatched_at');
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  // ── v22 → v23: merge_retry_count column (PAN-653) ──────────────────────────

  it('v22 → v23: adds merge_retry_count column to pre-PAN-653 review_status tables', () => {
    // Simulate a v22 database (has reviewed_at_commit but not merge_retry_count)
    initSchema(db);
    db.pragma('user_version = 22');
    db.exec(`
      CREATE TABLE review_status_v22 AS SELECT
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes, verification_cycle_count,
        verification_max_cycles, review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details, reviewed_at_commit
      FROM review_status;
      DROP TABLE review_status;
      ALTER TABLE review_status_v22 RENAME TO review_status;
    `);

    const colsBefore = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    expect(colsBefore.map(c => c.name)).not.toContain('merge_retry_count');

    runMigrations(db);

    const colsAfter = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    expect(colsAfter.map(c => c.name)).toContain('merge_retry_count');
  });

  it('v22 → v23: can write and read merge_retry_count after migration', () => {
    initSchema(db);
    db.pragma('user_version = 22');
    db.exec(`
      CREATE TABLE review_status_v22 AS SELECT
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes, verification_cycle_count,
        verification_max_cycles, review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details, reviewed_at_commit
      FROM review_status;
      DROP TABLE review_status;
      ALTER TABLE review_status_v22 RENAME TO review_status;
    `);

    db.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-MIGRATE-RC', 'passed', 'passed', '2026-01-01T00:00:00.000Z', 0)
    `).run();

    runMigrations(db);

    db.prepare(`UPDATE review_status SET merge_retry_count = ? WHERE issue_id = ?`).run(3, 'PAN-MIGRATE-RC');
    const row = db.prepare(`SELECT merge_retry_count FROM review_status WHERE issue_id = ?`).get('PAN-MIGRATE-RC') as { merge_retry_count: number };
    expect(row.merge_retry_count).toBe(3);
  });

  // ── v23 → v24: review_spawned_at and test_retry_count (PAN-699) ─────────────

  it('v23 → v24: adds review_spawned_at and test_retry_count columns to review_status', () => {
    initSchema(db);
    db.pragma('user_version = 23');
    db.exec(`
      CREATE TABLE review_status_v23 AS SELECT
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes, verification_cycle_count,
        verification_max_cycles, review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, merge_retry_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details, reviewed_at_commit
      FROM review_status;
      DROP TABLE review_status;
      ALTER TABLE review_status_v23 RENAME TO review_status;
    `);

    const colsBefore = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    expect(colsBefore.map(c => c.name)).not.toContain('review_spawned_at');
    expect(colsBefore.map(c => c.name)).not.toContain('test_retry_count');

    runMigrations(db);

    const colsAfter = db.prepare('PRAGMA table_info(review_status)').all<{ name: string }>();
    expect(colsAfter.map(c => c.name)).toContain('review_spawned_at');
    expect(colsAfter.map(c => c.name)).toContain('test_retry_count');
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('v23 → v24: can write and read new columns after migration', () => {
    initSchema(db);
    db.pragma('user_version = 23');
    db.exec(`
      CREATE TABLE review_status_v23 AS SELECT
        issue_id, review_status, test_status, merge_status,
        verification_status, verification_notes, verification_cycle_count,
        verification_max_cycles, review_notes, test_notes, merge_notes,
        updated_at, ready_for_merge, auto_requeue_count, merge_retry_count, pr_url,
        stuck, stuck_reason, stuck_at, stuck_details, reviewed_at_commit
      FROM review_status;
      DROP TABLE review_status;
      ALTER TABLE review_status_v23 RENAME TO review_status;
    `);

    db.prepare(`
      INSERT INTO review_status (issue_id, review_status, test_status, updated_at, ready_for_merge)
      VALUES ('PAN-MIGRATE-699', 'reviewing', 'pending', '2026-01-01T00:00:00.000Z', 0)
    `).run();

    runMigrations(db);

    db.prepare(`UPDATE review_status SET review_spawned_at = ?, test_retry_count = ? WHERE issue_id = ?`)
      .run('2026-04-20T12:00:00.000Z', 2, 'PAN-MIGRATE-699');
    const row = db.prepare(`SELECT review_spawned_at, test_retry_count FROM review_status WHERE issue_id = ?`)
      .get('PAN-MIGRATE-699') as { review_spawned_at: string; test_retry_count: number };
    expect(row.review_spawned_at).toBe('2026-04-20T12:00:00.000Z');
    expect(row.test_retry_count).toBe(2);
  });

  it('v52 → v53: adds conflict_resolution_dispatched_at idempotently', () => {
    db.pragma('user_version = 52');
    db.exec(`
      CREATE TABLE review_status (
        issue_id TEXT PRIMARY KEY,
        review_status TEXT NOT NULL DEFAULT 'pending',
        test_status TEXT NOT NULL DEFAULT 'pending',
        updated_at TEXT NOT NULL,
        ready_for_merge INTEGER NOT NULL DEFAULT 0
      );
    `);

    const colsBefore = db.pragma('table_info(review_status)') as Array<{ name: string }>;
    expect(colsBefore.map(c => c.name)).not.toContain('conflict_resolution_dispatched_at');

    runMigrations(db);
    runMigrations(db);

    const colsAfter = db.pragma('table_info(review_status)') as Array<{ name: string }>;
    expect(colsAfter.map(c => c.name)).toContain('conflict_resolution_dispatched_at');
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('leaves session_file unchanged when the corrected transcript is missing', () => {
    db.pragma('user_version = 15');
    initSchema(db);
    db.pragma('user_version = 15');

    const cwd = '/Users/edward.becker/Projects/overdeck';
    const stalePath = join(
      tempRoot,
      '.claude',
      'projects',
      '-Users-edward.becker-Projects-overdeck',
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
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('fresh initSchema includes fork recovery columns on conversations', () => {
    initSchema(db);

    const cols = db.pragma('table_info(conversations)') as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const forkRequest = cols.find((col) => col.name === 'fork_request');
    const forkRetryCount = cols.find((col) => col.name === 'fork_retry_count');

    expect(forkRequest).toBeDefined();
    expect(forkRetryCount).toMatchObject({ notnull: 1, dflt_value: '0' });
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('v52 → v53: adds fork recovery columns idempotently', () => {
    initSchema(db);
    db.pragma('user_version = 52');
    db.exec(`
      CREATE TABLE conversations_v52 AS SELECT
        id, name, tmux_session, status, cwd, issue_id, created_at, ended_at,
        last_attached_at, session_file, claude_session_id, title, title_source,
        title_seed, total_cost, total_tokens, archived_at, model, effort,
        fork_status, fork_error, harness, delivery_method, spawn_error,
        handoff_doc_path, handoff_target_conv_id, fork_fallback_reason, cleared_to_conv_id
      FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_v52 RENAME TO conversations;
    `);

    const before = db.pragma('table_info(conversations)') as Array<{ name: string }>;
    expect(before.map((col) => col.name)).not.toContain('fork_request');
    expect(before.map((col) => col.name)).not.toContain('fork_retry_count');

    runMigrations(db);
    runMigrations(db);

    const after = db.pragma('table_info(conversations)') as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const forkRequest = after.find((col) => col.name === 'fork_request');
    const forkRetryCount = after.find((col) => col.name === 'fork_retry_count');

    expect(forkRequest).toBeDefined();
    expect(forkRetryCount).toMatchObject({ notnull: 1, dflt_value: '0' });
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  // ── v53 → v54: forge column on pending_auto_merges (PAN-1887) ──────────────

  it('fresh initSchema includes forge column on pending_auto_merges', () => {
    initSchema(db);

    const cols = db.pragma('table_info(pending_auto_merges)') as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const forge = cols.find((col) => col.name === 'forge');

    expect(forge).toBeDefined();
    expect(forge).toMatchObject({ notnull: 1, dflt_value: "'github'" });
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('v53 → v54: adds forge column to pending_auto_merges idempotently', () => {
    initSchema(db);
    db.pragma('user_version = 53');
    db.exec(`
      CREATE TABLE pending_auto_merges_v53 AS SELECT
        id, issueId, prUrl, prNumber, projectKey, "status",
        scheduledMergeAt, scheduledAt, mergedAt, failureReason, cancelledAt, cancelledBy
      FROM pending_auto_merges;
      DROP TABLE pending_auto_merges;
      ALTER TABLE pending_auto_merges_v53 RENAME TO pending_auto_merges;
    `);

    db.prepare(`
      INSERT INTO pending_auto_merges (issueId, prUrl, prNumber, projectKey, "status", scheduledMergeAt, scheduledAt)
      VALUES ('PAN-MIGRATE-AM', 'https://github.com/eltmon/overdeck/pull/1', 1, 'overdeck', 'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();

    const before = db.pragma('table_info(pending_auto_merges)') as Array<{ name: string }>;
    expect(before.map((col) => col.name)).not.toContain('forge');

    runMigrations(db);
    runMigrations(db);

    const after = db.pragma('table_info(pending_auto_merges)') as Array<{ name: string; notnull: number; dflt_value: string | null }>;
    const forge = after.find((col) => col.name === 'forge');
    expect(forge).toBeDefined();
    expect(forge).toMatchObject({ notnull: 1, dflt_value: "'github'" });

    const row = db.prepare(`SELECT forge FROM pending_auto_merges WHERE issueId = ?`).get('PAN-MIGRATE-AM') as { forge: string };
    expect(row.forge).toBe('github');
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  // ── v54 → v55: agents runtime registry (PAN-1908) ─────────────────────────

  const EXPECTED_AGENTS_COLUMNS = [
    'id',
    'issue_id',
    'role',
    'status',
    'workspace',
    'harness',
    'model',
    'branch',
    'session_id',
    'started_at',
    'last_activity',
    'last_resume_at',
    'stopped_at',
    'stopped_by_user',
    'stopped_by_pause',
    'kickoff_delivered',
    'host_override',
    'cost_so_far',
    'phase',
    'work_type',
    'paused',
    'paused_reason',
    'paused_at',
    'troubled',
    'troubled_at',
    'consecutive_failures',
    'first_failure_in_run_at',
    'last_failure_at',
    'last_failure_reason',
    'last_failure_next_retry_at',
    'flywheel_run_id',
    'role_run_head',
    'review_sub_role',
    'review_run_id',
    'review_synthesis_agent_id',
    'review_output_path',
    'review_deadline_at',
    'review_monitor_signaled',
    'review_retry_attempt',
    'inspect_sub_role',
    'delivery_method',
    'supervisor_enabled',
    'channels_enabled',
    'updated_at',
  ];

  it('fresh initSchema creates the agents table with every PRD §5.1 column and indexes', () => {
    initSchema(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agents'`)
      .get() as { name: string } | undefined;
    expect(table?.name).toBe('agents');

    const cols = db.prepare('PRAGMA table_info(agents)').all<{ name: string }>();
    const names = cols.map((c) => c.name);
    for (const col of EXPECTED_AGENTS_COLUMNS) {
      expect(names).toContain(col);
    }

    const idCol = cols.find((c) => c.name === 'id');
    expect(idCol?.pk).toBe(1);

    const idxStatusRole = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_status_role'`)
      .get() as { name: string } | undefined;
    expect(idxStatusRole?.name).toBe('idx_agents_status_role');

    const idxIssue = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_issue'`)
      .get() as { name: string } | undefined;
    expect(idxIssue?.name).toBe('idx_agents_issue');

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('fresh agents table preserves channels_enabled and omits codexMode/preSpawnStash columns', () => {
    initSchema(db);

    const names = db
      .prepare('PRAGMA table_info(agents)')
      .all<{ name: string }>()
      .map((c) => c.name);

    expect(names).toContain('channels_enabled');
    expect(names).not.toContain('codexMode');
    expect(names).not.toContain('codex_mode');
    expect(names).not.toContain('preSpawnStashRef');
    expect(names).not.toContain('pre_spawn_stash_ref');
    expect(names).not.toContain('preSpawnStashMessage');
    expect(names).not.toContain('pre_spawn_stash_message');
    expect(names).not.toContain('preSpawnBaselineHead');
    expect(names).not.toContain('pre_spawn_baseline_head');
  });

  it('v54 → v55: creates agents table idempotently on an existing database', () => {
    db.pragma('user_version = 54');
    db.exec(`
      CREATE TABLE review_status (
        issue_id TEXT PRIMARY KEY,
        review_status TEXT NOT NULL DEFAULT 'pending',
        updated_at TEXT NOT NULL
      );
    `);

    const before = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agents'`)
      .get() as { name: string } | undefined;
    expect(before).toBeUndefined();

    runMigrations(db);
    runMigrations(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agents'`)
      .get() as { name: string } | undefined;
    expect(table?.name).toBe('agents');

    const cols = db.prepare('PRAGMA table_info(agents)').all<{ name: string }>();
    const names = cols.map((c) => c.name);
    for (const col of EXPECTED_AGENTS_COLUMNS) {
      expect(names).toContain(col);
    }

    expect(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_status_role'`)
        .get() as { name: string } | undefined,
    ).toBeDefined();
    expect(
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_agents_issue'`)
        .get() as { name: string } | undefined,
    ).toBeDefined();

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('v54 → v55: re-running migrations preserves existing agents rows', () => {
    db.pragma('user_version = 54');
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        workspace TEXT NOT NULL,
        channels_enabled INTEGER,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO agents (id, issue_id, role, status, workspace, channels_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('agent-pan-1908', 'PAN-1908', 'work', 'running', '/workspaces/feature-pan-1908', 0, '2026-06-15T00:00:00.000Z');

    runMigrations(db);
    runMigrations(db);

    const row = db.prepare(`SELECT id, issue_id, role, status, workspace, channels_enabled FROM agents WHERE id = ?`).get('agent-pan-1908') as {
      id: string;
      issue_id: string;
      role: string;
      status: string;
      workspace: string;
      channels_enabled: number;
    };
    expect(row).toBeDefined();
    expect(row.id).toBe('agent-pan-1908');
    expect(row.issue_id).toBe('PAN-1908');
    expect(row.status).toBe('running');
    expect(row.channels_enabled).toBe(0);

    const count = db.prepare(`SELECT COUNT(*) AS n FROM agents`).get() as { n: number };
    expect(count.n).toBe(1);
  });
});
