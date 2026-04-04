/**
 * Panopticon Database Schema
 *
 * Defines the unified schema for panopticon.db.
 * All persistent application state lives here.
 */

import type Database from 'better-sqlite3';

// Schema version — increment when making breaking schema changes
export const SCHEMA_VERSION = 5;

/**
 * Initialize the complete database schema.
 * Idempotent — uses CREATE TABLE IF NOT EXISTS throughout.
 */
export function initSchema(db: Database.Database): void {
  db.exec(`
    -- ===== Cost Events =====
    CREATE TABLE IF NOT EXISTS cost_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            TEXT    NOT NULL,
      agent_id      TEXT    NOT NULL,
      issue_id      TEXT    NOT NULL,
      session_type  TEXT    NOT NULL DEFAULT 'unknown',
      provider      TEXT    NOT NULL DEFAULT 'anthropic',
      model         TEXT    NOT NULL,
      input         INTEGER NOT NULL DEFAULT 0,
      output        INTEGER NOT NULL DEFAULT 0,
      cache_read    INTEGER NOT NULL DEFAULT 0,
      cache_write   INTEGER NOT NULL DEFAULT 0,
      cost          REAL    NOT NULL DEFAULT 0,
      request_id    TEXT,
      session_id    TEXT,    -- Claude Code session UUID (for reconciler offset tracking)
      -- TLDR metrics
      tldr_interceptions INTEGER,
      tldr_bypasses      INTEGER,
      tldr_tokens_saved  INTEGER,
      tldr_bypass_reasons TEXT,  -- JSON string
      -- WAL source tracking
      source_file   TEXT   -- path of WAL file this came from (for imports)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_request_id
      ON cost_events(request_id) WHERE request_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_cost_issue_id
      ON cost_events(issue_id, ts);

    CREATE INDEX IF NOT EXISTS idx_cost_agent_id
      ON cost_events(agent_id, ts);

    CREATE INDEX IF NOT EXISTS idx_cost_ts
      ON cost_events(ts);

    CREATE INDEX IF NOT EXISTS idx_cost_session_id
      ON cost_events(session_id) WHERE session_id IS NOT NULL;

    -- ===== Review Status =====
    CREATE TABLE IF NOT EXISTS review_status (
      issue_id              TEXT PRIMARY KEY,
      review_status         TEXT NOT NULL DEFAULT 'pending',
      test_status           TEXT NOT NULL DEFAULT 'pending',
      merge_status          TEXT,
      verification_status   TEXT,
      verification_notes    TEXT,
      verification_cycle_count  INTEGER DEFAULT 0,
      verification_max_cycles   INTEGER,
      review_notes          TEXT,
      test_notes            TEXT,
      merge_notes           TEXT,
      updated_at            TEXT NOT NULL,
      ready_for_merge       INTEGER NOT NULL DEFAULT 0,
      auto_requeue_count    INTEGER DEFAULT 0,
      pr_url                TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_review_status_updated
      ON review_status(updated_at);

    -- ===== Status History =====
    CREATE TABLE IF NOT EXISTS status_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id   TEXT NOT NULL,
      type       TEXT NOT NULL,  -- 'review', 'test', 'merge'
      status     TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      notes      TEXT,
      FOREIGN KEY (issue_id) REFERENCES review_status(issue_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_status_history_issue
      ON status_history(issue_id, timestamp);

    -- UNIQUE constraint enables INSERT OR IGNORE deduplication in upsertReviewStatus
    CREATE UNIQUE INDEX IF NOT EXISTS idx_status_history_unique
      ON status_history(issue_id, type, status, timestamp);

    -- ===== Health Events =====
    CREATE TABLE IF NOT EXISTS health_events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id       TEXT NOT NULL,
      timestamp      TEXT NOT NULL,
      state          TEXT NOT NULL,
      previous_state TEXT,
      source         TEXT,
      metadata       TEXT  -- JSON string
    );

    CREATE INDEX IF NOT EXISTS idx_health_agent_timestamp
      ON health_events(agent_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_health_timestamp
      ON health_events(timestamp);

    -- ===== Processed Sessions (for reconciler offset tracking) =====
    CREATE TABLE IF NOT EXISTS processed_sessions (
      session_id     TEXT PRIMARY KEY,
      agent_id       TEXT,
      issue_id       TEXT,
      transcript_path TEXT,           -- full path to the .jsonl file
      byte_offset    INTEGER NOT NULL DEFAULT 0,  -- bytes consumed so far
      processed_at   TEXT NOT NULL,
      event_count    INTEGER NOT NULL DEFAULT 0
    );

    -- ===== API Cache =====
    CREATE TABLE IF NOT EXISTS api_cache (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,  -- JSON string
      expires_at  TEXT,
      created_at  TEXT NOT NULL
    );

    -- ===== Rate Limits =====
    CREATE TABLE IF NOT EXISTS rate_limits (
      service     TEXT PRIMARY KEY,
      requests    INTEGER NOT NULL DEFAULT 0,
      window_start TEXT NOT NULL,
      limit_per_window INTEGER NOT NULL DEFAULT 1000
    );

    -- ===== Domain Events (PAN-428: push-first architecture) =====
    CREATE TABLE IF NOT EXISTS events (
      sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
      type      TEXT    NOT NULL,
      timestamp TEXT    NOT NULL,
      payload   TEXT    NOT NULL  -- JSON
    );

    CREATE INDEX IF NOT EXISTS idx_events_type
      ON events(type);

    CREATE INDEX IF NOT EXISTS idx_events_timestamp
      ON events(timestamp);

    -- ===== Conversations (PAN-416: Mission Control conversation launcher) =====
    CREATE TABLE IF NOT EXISTS conversations (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL UNIQUE,
      tmux_session     TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'active',  -- 'active', 'ended'
      cwd              TEXT    NOT NULL,
      issue_id         TEXT,                               -- optional cost attribution
      created_at       TEXT    NOT NULL,
      ended_at         TEXT,
      last_attached_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_status
      ON conversations(status);

    CREATE INDEX IF NOT EXISTS idx_conversations_created_at
      ON conversations(created_at);
  `);

  // Record schema version
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/**
 * Run schema migrations if the database version is older than SCHEMA_VERSION.
 * This function handles upgrading from older schema versions.
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  if (currentVersion === SCHEMA_VERSION) {
    return; // Already at latest version
  }

  if (currentVersion === 0) {
    // Fresh database — just initialize the full schema
    initSchema(db);
    return;
  }

  // v1 → v2: add UNIQUE index on status_history for INSERT OR IGNORE dedup
  if (currentVersion < 2) {
    // Remove duplicate rows before adding the unique index (keep lowest id per unique key)
    db.exec(`
      DELETE FROM status_history
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM status_history
        GROUP BY issue_id, type, status, timestamp
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_status_history_unique
        ON status_history(issue_id, type, status, timestamp);
    `);
  }

  // v2 → v3: add session_id to cost_events, extend processed_sessions for reconciler
  if (currentVersion < 3) {
    // Add session_id column to cost_events (nullable, no data loss)
    try {
      db.exec(`ALTER TABLE cost_events ADD COLUMN session_id TEXT`);
    } catch {
      // Column may already exist if schema was manually applied
    }

    // Add index on session_id
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cost_session_id
        ON cost_events(session_id) WHERE session_id IS NOT NULL;
    `);

    // Extend processed_sessions with new columns for reconciler
    try {
      db.exec(`ALTER TABLE processed_sessions ADD COLUMN agent_id TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`ALTER TABLE processed_sessions ADD COLUMN issue_id TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`ALTER TABLE processed_sessions ADD COLUMN transcript_path TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`ALTER TABLE processed_sessions ADD COLUMN byte_offset INTEGER NOT NULL DEFAULT 0`);
    } catch { /* already exists */ }
  }

  // v3 → v4: add events table for push-first architecture (PAN-428)
  if (currentVersion < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        sequence  INTEGER PRIMARY KEY AUTOINCREMENT,
        type      TEXT    NOT NULL,
        timestamp TEXT    NOT NULL,
        payload   TEXT    NOT NULL  -- JSON
      );

      CREATE INDEX IF NOT EXISTS idx_events_type
        ON events(type);

      CREATE INDEX IF NOT EXISTS idx_events_timestamp
        ON events(timestamp);
    `);
  }

  // v4 → v5: add conversations table (PAN-416)
  if (currentVersion < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL UNIQUE,
        tmux_session     TEXT    NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'active',
        cwd              TEXT    NOT NULL,
        issue_id         TEXT,
        created_at       TEXT    NOT NULL,
        ended_at         TEXT,
        last_attached_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_status
        ON conversations(status);

      CREATE INDEX IF NOT EXISTS idx_conversations_created_at
        ON conversations(created_at);
    `);
  }

  // After all migrations, set the version
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
