/**
 * Panopticon Database Schema
 *
 * Defines the unified schema for panopticon.db.
 * All persistent application state lives here.
 */

import type Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { encodeClaudeProjectDir } from '../paths.js';

// Schema version — increment when making breaking schema changes
export const SCHEMA_VERSION = 35;

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
      source_file   TEXT,  -- path of WAL file this came from (for imports)
      -- Caveman A/B experiment tracking
      caveman_variant TEXT  -- 'enabled', 'disabled', 'off', or null
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
      merge_retry_count     INTEGER DEFAULT 0,
      pr_url                TEXT,
      -- PAN-905: tracked PR identity for webhook correlation
      pr_head_sha           TEXT,
      pr_number             INTEGER,
      -- PAN-653: persistent stuck state (set when main diverges mid-approve)
      stuck                 INTEGER NOT NULL DEFAULT 0,
      stuck_reason          TEXT,
      stuck_at              TEXT,
      stuck_details         TEXT,
      -- PAN-653: commit SHA at which review passed (used by deacon to detect new pushes)
      reviewed_at_commit    TEXT,
      -- PAN-699: timestamp when review agents were dispatched (deacon timeout detection)
      review_spawned_at     TEXT,
      -- PAN-699: number of test-agent dispatch retries (circuit breaker)
      test_retry_count      INTEGER DEFAULT 0,
      -- PAN-794: parallel-review re-dispatch retry counter (scoped to current recovery cycle)
      review_retry_count    INTEGER DEFAULT 0,
      -- PAN-794: ISO timestamp marking the start of the current recovery cycle (breaker history cutoff)
      recovery_started_at   TEXT,
      -- Human-requested deacon ignore: when set, patrol skips this issue entirely
      deacon_ignored          INTEGER NOT NULL DEFAULT 0,
      deacon_ignored_at       TEXT,
      deacon_ignored_reason   TEXT,
      -- PAN-905: GitHub-native merge blocker reasons (JSON array)
      blocker_reasons         TEXT,
      -- PAN-938: pre-review verification gate commit SHA
      last_verified_commit    TEXT,
      -- PAN-938: current merge pipeline step
      merge_step              TEXT
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

    -- ===== App Settings (global key/value) =====
    -- Generic persisted settings that survive restarts. Currently used for the
    -- global deacon pause flag; add keys here rather than spawning new tables
    -- for every bool/string the dashboard wants to remember.
    CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
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

    -- ===== Projection Cache (PAN-437: instant dashboard startup) =====
    CREATE TABLE IF NOT EXISTS projection_cache (
      key        TEXT PRIMARY KEY,
      data       TEXT NOT NULL,     -- JSON-serialized DashboardSnapshot
      sequence   INTEGER NOT NULL,  -- Last event sequence applied
      updated_at TEXT NOT NULL      -- ISO timestamp
    );

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
      last_attached_at TEXT,
      session_file     TEXT,                               -- @deprecated: path to Claude Code JSONL session file (PAN-451). Kept for legacy rows — use claude_session_id.
      claude_session_id TEXT,                              -- Claude Code session UUID. Immutable for the lifetime of the conversation.
      title            TEXT,                               -- human-readable title, auto-set from first message
      title_source     TEXT,                               -- 'auto', 'ai', or 'manual'
      title_seed       TEXT,                               -- original auto-generated title for replacement check
      total_cost       REAL DEFAULT 0,                     -- cached total cost in USD
      archived_at      TEXT,                               -- ISO timestamp when archived, null = active
      model            TEXT,                               -- model used to spawn conversation (e.g. 'minimax-m2.7-highspeed')
      effort           TEXT,                               -- effort level (e.g. 'low', 'medium', 'high')
      fork_status      TEXT,                               -- async fork provisioning: summarizing, spawning, injecting, failed (null = not a fork or done)
      fork_error       TEXT,                               -- error message when fork_status='failed'
      harness          TEXT,                                -- coding harness used for conversation runtime
      delivery_method  TEXT,                               -- 'auto', 'channels', or 'tmux'
      spawn_error      TEXT                                -- error message when background spawn failed (quota, auth, etc.)
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_status
      ON conversations(status);

    CREATE INDEX IF NOT EXISTS idx_conversations_created_at
      ON conversations(created_at);

    CREATE INDEX IF NOT EXISTS idx_conversations_archived_created
      ON conversations(archived_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_status_archived_created
      ON conversations(status, archived_at, created_at);

    -- ===== Favorites (PAN-662: conversation favorites) =====
    CREATE TABLE IF NOT EXISTS favorites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,  -- 'conversation' or 'project'
      item_id    TEXT NOT NULL,  -- conversation name or project path
      created_at TEXT NOT NULL,
      UNIQUE(type, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_type
      ON favorites(type);

    -- ===== Merge Queue (PAN-632: persistent merge serialization) =====
    CREATE TABLE IF NOT EXISTS merge_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      issue_id    TEXT NOT NULL UNIQUE,
      position    INTEGER NOT NULL,
      queued_at   TEXT NOT NULL,
      started_at  TEXT,
      status      TEXT NOT NULL DEFAULT 'queued'
    );

    CREATE INDEX IF NOT EXISTS idx_merge_queue_project
      ON merge_queue(project_key, status, position);

    -- ===== Merge Sets (PAN-632: multi-repo merge coordination state) =====
    CREATE TABLE IF NOT EXISTS merge_sets (
      issue_id       TEXT PRIMARY KEY,
      project_key    TEXT NOT NULL,
      project_path   TEXT NOT NULL,
      workspace_type TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'draft',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_merge_sets_project
      ON merge_sets(project_key, updated_at);

    CREATE TABLE IF NOT EXISTS merge_set_repos (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id            TEXT NOT NULL,
      repo_key            TEXT NOT NULL,
      repo_path           TEXT NOT NULL,
      forge               TEXT NOT NULL,
      source_branch       TEXT NOT NULL,
      target_branch       TEXT NOT NULL,
      artifact_url        TEXT,
      artifact_id         TEXT,
      review_status       TEXT NOT NULL DEFAULT 'pending',
      test_status         TEXT NOT NULL DEFAULT 'pending',
      rebase_status       TEXT NOT NULL DEFAULT 'pending',
      verification_status TEXT NOT NULL DEFAULT 'pending',
      merge_status        TEXT NOT NULL DEFAULT 'pending',
      merge_order         INTEGER NOT NULL DEFAULT 0,
      required            INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (issue_id) REFERENCES merge_sets(issue_id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_set_repos_issue_repo
      ON merge_set_repos(issue_id, repo_key);

    CREATE INDEX IF NOT EXISTS idx_merge_set_repos_issue_order
      ON merge_set_repos(issue_id, merge_order, repo_key);

    -- ===== Git Operations (PAN-653: persistent git event log) =====
    CREATE TABLE IF NOT EXISTS git_operations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      operation   TEXT NOT NULL,   -- e.g. 'push', 'fetch', 'force_push', 'merge', 'rev_parse'
      branch      TEXT,
      issue_id    TEXT,
      before_sha  TEXT,
      after_sha   TEXT,
      remote_sha  TEXT,
      status      TEXT NOT NULL,   -- 'success' | 'failure' | 'aborted'
      error       TEXT,
      ts          TEXT NOT NULL    -- ISO 8601 timestamp
    );

    CREATE INDEX IF NOT EXISTS idx_git_ops_issue_ts
      ON git_operations(issue_id, ts);

    CREATE INDEX IF NOT EXISTS idx_git_ops_op_ts
      ON git_operations(operation, ts);

    -- ===== Discovered Sessions (PAN-457: conversation discovery & indexing) =====
    CREATE TABLE IF NOT EXISTS discovered_sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      jsonl_path        TEXT    NOT NULL UNIQUE,
      session_id        TEXT,
      workspace_path    TEXT,
      workspace_hash    TEXT,
      message_count     INTEGER NOT NULL DEFAULT 0,
      first_ts          TEXT,
      last_ts           TEXT,
      models_used       TEXT,
      primary_model     TEXT,
      token_input       INTEGER NOT NULL DEFAULT 0,
      token_output      INTEGER NOT NULL DEFAULT 0,
      estimated_cost    REAL    NOT NULL DEFAULT 0,
      tools_used        TEXT,
      files_touched     TEXT,
      tags              TEXT,
      summary           TEXT,
      summary_detailed  TEXT,
      enrichment_level  INTEGER NOT NULL DEFAULT 0,
      enrichment_model  TEXT,
      enriched_at       TEXT,
      enrichment_failed INTEGER NOT NULL DEFAULT 0,
      panopticon_managed INTEGER NOT NULL DEFAULT 0,
      pan_issue_id      TEXT,
      pan_agent_id      TEXT,
      file_size         INTEGER,
      file_mtime        TEXT,
      scanned_at        TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_discovered_workspace
      ON discovered_sessions(workspace_path);

    CREATE INDEX IF NOT EXISTS idx_discovered_last_ts
      ON discovered_sessions(last_ts);

    CREATE INDEX IF NOT EXISTS idx_discovered_enrichment
      ON discovered_sessions(enrichment_level, enriched_at);

    CREATE INDEX IF NOT EXISTS idx_discovered_managed
      ON discovered_sessions(panopticon_managed, pan_issue_id);

    CREATE INDEX IF NOT EXISTS idx_discovered_model
      ON discovered_sessions(primary_model);

    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      summary,
      summary_detailed,
      tags,
      files_touched,
      content='discovered_sessions',
      content_rowid='id'
    );

    -- ===== Session Embeddings (PAN-457: semantic search) =====
    CREATE TABLE IF NOT EXISTS session_embeddings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL
                   REFERENCES discovered_sessions(id) ON DELETE CASCADE,
      model      TEXT    NOT NULL,
      dim        INTEGER NOT NULL,
      embedding  BLOB    NOT NULL,
      created_at TEXT    NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_embeddings_session_model
      ON session_embeddings(session_id, model);
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

  // v4 → v5: add projection_cache table (PAN-437: instant dashboard startup)
  if (currentVersion < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projection_cache (
        key        TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        sequence   INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  // v5 → v6: add conversations table (PAN-416)
  if (currentVersion < 6) {
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

  // v6 → v7: add session_file column to conversations (PAN-451)
  if (currentVersion < 7) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN session_file TEXT`);
    } catch { /* already exists */ }
  }

  // v7 → v8: add title column to conversations (auto-set from first message)
  if (currentVersion < 8) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN title TEXT`);
    } catch { /* already exists */ }
  }

  // v8 → v9: add title_source and title_seed columns to conversations
  // title_source tracks how the title was set: 'auto' (truncated first message),
  // 'ai' (Claude-generated), or 'manual' (user renamed). Used for T3Code-style
  // canReplaceThreadTitle logic — only auto-generated titles get AI replacement.
  // title_seed stores the original truncated message for replacement eligibility.
  if (currentVersion < 9) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN title_source TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN title_seed TEXT`);
    } catch { /* already exists */ }
  }

  // v9 → v10: add total_cost column to conversations (cached cost in USD)
  if (currentVersion < 10) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN total_cost REAL DEFAULT 0`);
    } catch { /* already exists */ }
  }

  // v10 → v11: expression index for UPPER(issue_id) on cost_events
  // The N+1 queries in getCostsByIssueFromDb use UPPER(issue_id) which defeats
  // the existing idx_cost_issue_id index. This expression index fixes that.
  if (currentVersion < 11) {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_issue_upper ON cost_events(UPPER(issue_id))`);
    } catch { /* already exists */ }
  }

  // v11 → v12: archived_at column + index for conversations (T3Code pattern)
  if (currentVersion < 12) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN archived_at TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(archived_at)`);
    } catch { /* already exists */ }
  }

  // v12 → v13: add model + effort columns to conversations (preserve model on resume)
  if (currentVersion < 13) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN model TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN effort TEXT`);
    } catch { /* already exists */ }
  }

  // v13 → v14: add merge_queue table (PAN-632: persistent merge serialization)
  if (currentVersion < 14) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS merge_queue (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_key TEXT NOT NULL,
        issue_id    TEXT NOT NULL UNIQUE,
        position    INTEGER NOT NULL,
        queued_at   TEXT NOT NULL,
        started_at  TEXT,
        status      TEXT NOT NULL DEFAULT 'queued'
      );
      CREATE INDEX IF NOT EXISTS idx_merge_queue_project
        ON merge_queue(project_key, status, position);
    `);
  }

  // v14 → v15: add merge set tables for multi-repo merge coordination
  if (currentVersion < 15) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS merge_sets (
        issue_id       TEXT PRIMARY KEY,
        project_key    TEXT NOT NULL,
        project_path   TEXT NOT NULL,
        workspace_type TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'draft',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_merge_sets_project
        ON merge_sets(project_key, updated_at);
      CREATE TABLE IF NOT EXISTS merge_set_repos (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id            TEXT NOT NULL,
        repo_key            TEXT NOT NULL,
        repo_path           TEXT NOT NULL,
        forge               TEXT NOT NULL,
        source_branch       TEXT NOT NULL,
        target_branch       TEXT NOT NULL,
        artifact_url        TEXT,
        artifact_id         TEXT,
        review_status       TEXT NOT NULL DEFAULT 'pending',
        test_status         TEXT NOT NULL DEFAULT 'pending',
        rebase_status       TEXT NOT NULL DEFAULT 'pending',
        verification_status TEXT NOT NULL DEFAULT 'pending',
        merge_status        TEXT NOT NULL DEFAULT 'pending',
        merge_order         INTEGER NOT NULL DEFAULT 0,
        required            INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (issue_id) REFERENCES merge_sets(issue_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_merge_set_repos_issue_repo
        ON merge_set_repos(issue_id, repo_key);
      CREATE INDEX IF NOT EXISTS idx_merge_set_repos_issue_order
        ON merge_set_repos(issue_id, merge_order, repo_key);
    `);
  }

  // v15 → v16: fix stale session_file paths with old CWD encoding (PAN-594)
  if (currentVersion < 16) {
    const conversations = db
      .prepare(
        `SELECT id, cwd, session_file FROM conversations WHERE session_file IS NOT NULL`
      )
      .all() as Array<{ id: number; cwd: string; session_file: string }>;

    for (const conversation of conversations) {
      const match = conversation.session_file.match(
        /^(.*[/\\]\.claude[/\\]projects[/\\])([^/\\]+)([/\\]sessions[/\\][^/\\]+\.jsonl)$/
      );

      if (!match) {
        continue;
      }

      const [, prefix, encodedSegment, suffix] = match;
      const expectedSegment = encodeClaudeProjectDir(conversation.cwd);

      if (encodedSegment === expectedSegment) {
        continue;
      }

      const correctedPath = `${prefix}${expectedSegment}${suffix}`;
      if (!existsSync(correctedPath)) {
        continue;
      }

      db.prepare(`UPDATE conversations SET session_file = ? WHERE id = ?`).run(
        correctedPath,
        conversation.id
      );
    }
  }

  // v16 → v17: add favorites table (PAN-662: conversation favorites)
  if (currentVersion < 17) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        type       TEXT NOT NULL,
        item_id    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(type, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_favorites_type
        ON favorites(type);
    `);
  }

  // v17 → v18: add caveman_variant column to cost_events (PAN-611 A/B experiment tracking)
  if (currentVersion < 18) {
    try {
      db.exec(`ALTER TABLE cost_events ADD COLUMN caveman_variant TEXT`);
    } catch { /* already exists */ }
  }

  // v18 → v19: add fork_status/fork_error to conversations + create discovered_sessions tables
  if (currentVersion < 19) {
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN fork_status TEXT`);
    } catch { /* already exists */ }
    try {
      db.exec(`ALTER TABLE conversations ADD COLUMN fork_error TEXT`);
    } catch { /* already exists */ }
    db.exec(`
      CREATE TABLE IF NOT EXISTS discovered_sessions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        jsonl_path        TEXT    NOT NULL UNIQUE,
        session_id        TEXT,
        workspace_path    TEXT,
        workspace_hash    TEXT,
        message_count     INTEGER NOT NULL DEFAULT 0,
        first_ts          TEXT,
        last_ts           TEXT,
        models_used       TEXT,
        primary_model     TEXT,
        token_input       INTEGER NOT NULL DEFAULT 0,
        token_output      INTEGER NOT NULL DEFAULT 0,
        estimated_cost    REAL    NOT NULL DEFAULT 0,
        tools_used        TEXT,
        files_touched     TEXT,
        tags              TEXT,
        summary           TEXT,
        summary_detailed  TEXT,
        enrichment_level  INTEGER NOT NULL DEFAULT 0,
        enrichment_model  TEXT,
        enriched_at       TEXT,
        enrichment_failed INTEGER NOT NULL DEFAULT 0,
        panopticon_managed INTEGER NOT NULL DEFAULT 0,
        pan_issue_id      TEXT,
        pan_agent_id      TEXT,
        file_size         INTEGER,
        file_mtime        TEXT,
        scanned_at        TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discovered_workspace ON discovered_sessions(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_discovered_last_ts ON discovered_sessions(last_ts);
      CREATE INDEX IF NOT EXISTS idx_discovered_enrichment ON discovered_sessions(enrichment_level, enriched_at);
      CREATE INDEX IF NOT EXISTS idx_discovered_managed ON discovered_sessions(panopticon_managed, pan_issue_id);
      CREATE INDEX IF NOT EXISTS idx_discovered_model ON discovered_sessions(primary_model);
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        summary, summary_detailed, tags, files_touched,
        content='discovered_sessions', content_rowid='id'
      );
      CREATE TABLE IF NOT EXISTS session_embeddings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES discovered_sessions(id) ON DELETE CASCADE,
        model      TEXT    NOT NULL,
        dim        INTEGER NOT NULL,
        embedding  BLOB    NOT NULL,
        created_at TEXT    NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_embeddings_session_model
        ON session_embeddings(session_id, model);
    `);
  }

  // v19 → v20: add persistent stuck state columns to review_status (PAN-653)
  // Each ALTER TABLE is wrapped in try/catch — SQLite requires separate statements
  // per column and columns may pre-exist if a prior attempt partially ran.
  if (currentVersion < 20) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN stuck INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN stuck_reason TEXT`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN stuck_at TEXT`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN stuck_details TEXT`); } catch { /* already exists */ }
  }

  // v20 → v21: add git_operations table (PAN-653: persistent git event log)
  if (currentVersion < 21) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS git_operations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        operation   TEXT NOT NULL,
        branch      TEXT,
        issue_id    TEXT,
        before_sha  TEXT,
        after_sha   TEXT,
        remote_sha  TEXT,
        status      TEXT NOT NULL,
        error       TEXT,
        ts          TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_git_ops_issue_ts
        ON git_operations(issue_id, ts);
      CREATE INDEX IF NOT EXISTS idx_git_ops_op_ts
        ON git_operations(operation, ts);
    `);
  }

  // v21 → v22: add reviewed_at_commit column to review_status (PAN-653)
  // Stores the HEAD commit SHA at which review passed; deacon uses this to detect
  // new commits pushed after review and invalidate the approved status.
  if (currentVersion < 22) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN reviewed_at_commit TEXT`); } catch { /* already exists */ }
  }

  // v22 → v23: add merge_retry_count column to review_status (PAN-653)
  // Deacon's circuit breaker for failed-merge retries — must persist across restarts.
  if (currentVersion < 23) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN merge_retry_count INTEGER DEFAULT 0`); } catch { /* already exists */ }
  }

  // v23 → v24: add review_spawned_at and test_retry_count columns (PAN-699)
  // review_spawned_at: tracks when parallel review was dispatched for orphan detection
  // test_retry_count: circuit breaker for test-agent dispatch retries
  if (currentVersion < 24) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN review_spawned_at TEXT`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN test_retry_count INTEGER DEFAULT 0`); } catch { /* already exists */ }
  }

  // v24 → v25: add review_retry_count and recovery_started_at columns (PAN-794)
  // Circuit breaker for parallel-review re-dispatch loops + explicit cycle boundary.
  if (currentVersion < 25) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN review_retry_count INTEGER DEFAULT 0`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN recovery_started_at TEXT`); } catch { /* already exists */ }
  }

  // v25 → v26: add human-set deacon-ignore flag (per-issue opt-out of patrol).
  if (currentVersion < 26) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN deacon_ignored INTEGER NOT NULL DEFAULT 0`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN deacon_ignored_at TEXT`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN deacon_ignored_reason TEXT`); } catch { /* already exists */ }
  }

  // v26 → v27: add app_settings table for persisted global flags.
  // Seed `deacon.globally_paused` = true on first install of this migration so
  // the dashboard comes up with Deacon frozen during the PAN-794 cutover. The
  // toggle in the UI flips it back to false when we're ready to let Deacon run.
  if (currentVersion < 27) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key         TEXT PRIMARY KEY,
          value       TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        )
      `);
    } catch { /* already exists */ }
    try {
      db.prepare(
        `INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`
      ).run('deacon.globally_paused', 'true', new Date().toISOString());
    } catch (err) {
      console.warn('[schema] Failed to seed deacon.globally_paused:', err);
    }
  }

  // v27 → v28: replace session_file with claude_session_id (PAN-451)
  // Storing the full JSONL path in the DB caused divergence when tmux sessions
  // were restarted — the path could go stale while a new JSONL file was written.
  // Store the session UUID instead and compute the path on demand.
  if (currentVersion < 28) {
    try { db.exec(`ALTER TABLE conversations ADD COLUMN claude_session_id TEXT`); } catch { /* already exists */ }

    const conversations = db
      .prepare(`SELECT id, session_file FROM conversations WHERE session_file IS NOT NULL`)
      .all() as Array<{ id: number; session_file: string }>;

    for (const conv of conversations) {
      const sessionId = conv.session_file.split('/').pop()?.replace('.jsonl', '') ?? null;
      if (sessionId) {
        db.prepare(`UPDATE conversations SET claude_session_id = ? WHERE id = ?`).run(sessionId, conv.id);
      }
    }
  }

  // v28 → v29: add composite index on conversations(status, archived_at, created_at)
  // for the kanban list query that filters by status + archived_at and orders by created_at.
  if (currentVersion < 29) {
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_conversations_status_archived_created
          ON conversations(status, archived_at, created_at)
      `);
    } catch { /* already exists */ }
  }

  // v29 → v30: add blocker_reasons column to review_status (PAN-905)
  if (currentVersion < 30) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN blocker_reasons TEXT`); } catch { /* already exists */ }
  }

  // v30 → v31: add pr_head_sha and pr_number for webhook PR identity validation (PAN-905)
  if (currentVersion < 31) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN pr_head_sha TEXT`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN pr_number INTEGER`); } catch { /* already exists */ }
  }

  // v31 → v32: add last_verified_commit and merge_step to review_status
  if (currentVersion < 32) {
    try { db.exec(`ALTER TABLE review_status ADD COLUMN last_verified_commit TEXT`); } catch { /* already exists */ }
    try { db.exec(`ALTER TABLE review_status ADD COLUMN merge_step TEXT`); } catch { /* already exists */ }
  }

  // v32 → v33: persist harness used by conversations and forks (PAN-1055)
  if (currentVersion < 33) {
    try { db.exec(`ALTER TABLE conversations ADD COLUMN harness TEXT`); } catch { /* already exists */ }
  }

  // v33 → v34: add delivery_method to conversations for channels/tmux toggle
  if (currentVersion < 34) {
    try { db.exec(`ALTER TABLE conversations ADD COLUMN delivery_method TEXT`); } catch { /* already exists */ }
  }

  // v34 → v35: add spawn_error column for background spawn failures (quota, auth, etc.)
  if (currentVersion < 35) {
    try { db.exec(`ALTER TABLE conversations ADD COLUMN spawn_error TEXT`); } catch { /* already exists */ }
  }

  // After all migrations, set the version
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
