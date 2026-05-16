/**
 * Conversations SQLite Storage (PAN-416)
 *
 * CRUD operations for the conversations table — session metadata for
 * user-driven Claude conversations spawned from Mission Control.
 */

import { getDatabase } from './index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TitleSource = 'auto' | 'ai' | 'manual' | 'default';

export interface Conversation {
  id: number;
  name: string;
  tmuxSession: string;
  status: 'active' | 'ended';
  cwd: string;
  issueId: string | null;
  createdAt: string;
  endedAt: string | null;
  lastAttachedAt: string | null;
  /** Claude Code session UUID. Immutable for the lifetime of the conversation. */
  claudeSessionId: string | null;
  /** Human-readable title, auto-set from first message content. Null until first message sent. */
  title: string | null;
  /** How the title was set: 'auto' (truncated message), 'ai' (Claude-generated), 'manual' (user renamed). */
  titleSource: TitleSource | null;
  /** Original auto-generated title seed — used for canReplaceThreadTitle logic. */
  titleSeed: string | null;
  /** Cached total cost in USD, updated when messages are fetched. */
  totalCost: number;
  /** ISO timestamp when archived, null = not archived. */
  archivedAt: string | null;
  /** Model used to spawn this conversation (e.g. 'minimax-m2.7-highspeed'). Null = default. */
  model: string | null;
  /** Effort level (e.g. 'low', 'medium', 'high'). Null = default. */
  effort: string | null;
  /** Async fork provisioning status: summarizing, spawning, injecting, failed. Null = not a fork or completed. */
  forkStatus: string | null;
  /** Error message when forkStatus='failed'. */
  forkError: string | null;
  /** Coding harness used to spawn this conversation. */
  harness: 'claude-code' | 'pi' | null;
  /** Delivery method for messages: 'auto' tries channels then tmux, 'channels' is strict, 'tmux' bypasses channels. */
  deliveryMethod: 'auto' | 'channels' | 'tmux' | null;
  /** Error message when background spawn failed (e.g. quota exhausted, auth error). Null = spawned OK or not yet known. */
  spawnError: string | null;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: row['id'] as number,
    name: row['name'] as string,
    tmuxSession: row['tmux_session'] as string,
    status: row['status'] as 'active' | 'ended',
    cwd: row['cwd'] as string,
    issueId: (row['issue_id'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    endedAt: (row['ended_at'] as string | null) ?? null,
    lastAttachedAt: (row['last_attached_at'] as string | null) ?? null,
    claudeSessionId: (row['claude_session_id'] as string | null) ?? null,
    title: (row['title'] as string | null) ?? null,
    titleSource: (row['title_source'] as TitleSource | null) ?? null,
    titleSeed: (row['title_seed'] as string | null) ?? null,
    totalCost: (row['total_cost'] as number) ?? 0,
    archivedAt: (row['archived_at'] as string | null) ?? null,
    model: (row['model'] as string | null) ?? null,
    effort: (row['effort'] as string | null) ?? null,
    forkStatus: (row['fork_status'] as string | null) ?? null,
    forkError: (row['fork_error'] as string | null) ?? null,
    harness: (row['harness'] === 'pi' || row['harness'] === 'claude-code') ? row['harness'] : null,
    deliveryMethod: (row['delivery_method'] === 'auto' || row['delivery_method'] === 'channels' || row['delivery_method'] === 'tmux')
      ? row['delivery_method'] as 'auto' | 'channels' | 'tmux'
      : null,
    spawnError: (row['spawn_error'] as string | null) ?? null,
  };
}

/** Agent-managed conversation names that should not appear in the user conversation list. */
const AGENT_CONVERSATION_PREFIXES = ['agent-', 'planning-', 'specialist-'];

/** True if the conversation name belongs to an orchestrator-managed agent session. */
export function isAgentConversationName(name: string): boolean {
  return AGENT_CONVERSATION_PREFIXES.some((p) => name.startsWith(p));
}

// ─── Read operations ──────────────────────────────────────────────────────────

export function listConversations(options?: { limit?: number; offset?: number }): Conversation[] {
  const db = getDatabase();
  let sql = `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations
       WHERE archived_at IS NULL
         AND name NOT LIKE 'agent-%'
         AND name NOT LIKE 'planning-%'
         AND name NOT LIKE 'specialist-%'
       ORDER BY created_at DESC`;
  const params: number[] = [];
  if (options?.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset !== undefined) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToConversation);
}

export function listActiveConversations(): Conversation[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations
       WHERE archived_at IS NULL AND status = 'active'
       ORDER BY created_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToConversation);
}

export function getConversationByName(name: string): Conversation | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations
       WHERE name = ?`,
    )
    .get(name) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

export function getConversationById(id: number): Conversation | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations
       WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

export function getConversationByClaudeSessionId(claudeSessionId: string): Conversation | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations
       WHERE claude_session_id = ?`,
    )
    .get(claudeSessionId) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

export function listArchivedConversations(): Conversation[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations
       WHERE archived_at IS NOT NULL
       ORDER BY archived_at DESC, created_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToConversation);
}

export function listArchivedConversationNames(): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT name FROM conversations WHERE archived_at IS NOT NULL`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

// ─── Write operations ─────────────────────────────────────────────────────────

export function createConversation(opts: {
  name: string;
  tmuxSession: string;
  cwd: string;
  issueId?: string;
  claudeSessionId?: string;
  title?: string;
  titleSource?: TitleSource;
  titleSeed?: string;
  model?: string;
  effort?: string;
  forkStatus?: string;
  harness?: 'claude-code' | 'pi';
  deliveryMethod?: 'auto' | 'channels' | 'tmux';
}): Conversation {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Remove any stale row with the same name so respawned specialist roles
  // (e.g. review convoy sub-roles re-running on a new review cycle) do not
  // hit UNIQUE constraint failures. The old JSONL session file is left
  // intact per the sacred-JSONL rule; only the DB record is replaced.
  db.prepare(`DELETE FROM conversations WHERE name = ?`).run(opts.name);

  // title_source is NOT NULL but has a DB-side default of 'auto'. Omit from
  // INSERT column list when not provided so the default applies.
  let sql: string;
  let params: unknown[];
  if (opts.titleSource !== undefined) {
    sql = `INSERT INTO conversations (name, tmux_session, status, cwd, issue_id, created_at, claude_session_id, title, title_source, title_seed, model, effort, fork_status, harness, delivery_method)
           VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    params = [
      opts.name,
      opts.tmuxSession,
      opts.cwd,
      opts.issueId ?? null,
      now,
      opts.claudeSessionId ?? null,
      opts.title ?? null,
      opts.titleSource,
      opts.titleSeed ?? null,
      opts.model ?? null,
      opts.effort ?? null,
      opts.forkStatus ?? null,
      opts.harness ?? null,
      opts.deliveryMethod ?? null,
    ];
  } else {
    sql = `INSERT INTO conversations (name, tmux_session, status, cwd, issue_id, created_at, claude_session_id, title, title_seed, model, effort, fork_status, harness, delivery_method)
           VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    params = [
      opts.name,
      opts.tmuxSession,
      opts.cwd,
      opts.issueId ?? null,
      now,
      opts.claudeSessionId ?? null,
      opts.title ?? null,
      opts.titleSeed ?? null,
      opts.model ?? null,
      opts.effort ?? null,
      opts.forkStatus ?? null,
      opts.harness ?? null,
      opts.deliveryMethod ?? null,
    ];
  }

  const result = db.prepare(sql).run(...params);
  const conv = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, claude_session_id, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error, harness, delivery_method, spawn_error
       FROM conversations WHERE id = ?`,
    )
    .get(result.lastInsertRowid) as Record<string, unknown>;
  return rowToConversation(conv);
}

export function markConversationEnded(name: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET status = 'ended', ended_at = ? WHERE name = ?`,
  ).run(new Date().toISOString(), name);
}

export function markConversationActive(name: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET status = 'active', last_attached_at = ? WHERE name = ?`,
  ).run(new Date().toISOString(), name);
}

export function reactivateConversationForSpawn(opts: {
  name: string;
  tmuxSession: string;
  cwd: string;
  issueId?: string;
  claudeSessionId?: string;
  model?: string;
  harness?: 'claude-code' | 'pi';
}): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations
     SET tmux_session = ?, status = 'active', cwd = ?, issue_id = ?, last_attached_at = ?,
         claude_session_id = ?, model = ?, harness = ?, archived_at = NULL
     WHERE name = ?`,
  ).run(
    opts.tmuxSession,
    opts.cwd,
    opts.issueId ?? null,
    new Date().toISOString(),
    opts.claudeSessionId ?? null,
    opts.model ?? null,
    opts.harness ?? null,
    opts.name,
  );
}

export function updateLastAttached(name: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET last_attached_at = ? WHERE name = ?`,
  ).run(new Date().toISOString(), name);
}

/** Mark all active conversations as ended — called on server startup to recover stale state. */
export function markAllEndedOnStartup(): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET status = 'ended', ended_at = ? WHERE status = 'active'`,
  ).run(new Date().toISOString());
}

/** Set the human-readable title for a conversation. */
export function updateConversationTitle(name: string, title: string, titleSource?: TitleSource): void {
  const db = getDatabase();
  if (titleSource) {
    db.prepare(
      `UPDATE conversations SET title = ?, title_source = ? WHERE name = ?`,
    ).run(title, titleSource, name);
  } else {
    db.prepare(
      `UPDATE conversations SET title = ? WHERE name = ?`,
    ).run(title, name);
  }
}

/** Archive a conversation — hides from list but preserves all data. */
export function archiveConversation(name: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET archived_at = ? WHERE name = ?`,
  ).run(new Date().toISOString(), name);
}

/** Unarchive a conversation — restores to the active list. */
export function unarchiveConversation(name: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET archived_at = NULL WHERE name = ?`,
  ).run(name);
}

/** Update the cached total cost for a conversation. */
export function updateConversationCost(name: string, totalCost: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET total_cost = ? WHERE name = ?`,
  ).run(totalCost, name);
}

/** Set the model for a conversation unconditionally. */
export function setConversationModel(name: string, model: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET model = ? WHERE name = ?`,
  ).run(model, name);
}

export function setConversationHarness(name: string, harness: 'claude-code' | 'pi'): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET harness = ? WHERE name = ?`,
  ).run(harness, name);
}

/**
 * Point a conversation at a new session UUID. Used when a harness change
 * converts the transcript into a new format/file — the DB must track the
 * converted session, not the orphaned original (P0, 2026-05-14).
 */
export function setConversationClaudeSessionId(name: string, claudeSessionId: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET claude_session_id = ? WHERE name = ?`,
  ).run(claudeSessionId, name);
}

export function updateConversationDeliveryMethod(name: string, method: 'auto' | 'channels' | 'tmux' | null): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET delivery_method = ? WHERE name = ?`,
  ).run(method, name);
}

/** Backfill the model for a conversation only when currently NULL. */
export function backfillConversationModel(name: string, model: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET model = ? WHERE name = ? AND model IS NULL`,
  ).run(model, name);
}

export function updateForkStatus(name: string, status: string | null, error?: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET fork_status = ?, fork_error = ? WHERE name = ?`,
  ).run(status, error ?? null, name);
}

export function updateSpawnError(name: string, error: string | null): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET spawn_error = ? WHERE name = ?`,
  ).run(error, name);
}

export function clearStuckForks(): number {
  const db = getDatabase();
  const result = db.prepare(
    `UPDATE conversations SET fork_status = 'failed', fork_error = 'Dashboard restarted during fork'
     WHERE fork_status IS NOT NULL AND fork_status != 'failed'`,
  ).run();
  return result.changes;
}

/**
 * T3Code-style title replacement eligibility check.
 * A title can be replaced by AI if:
 * - It matches the titleSeed (auto-generated from first message), OR
 * - titleSource is 'auto' (never been manually renamed or AI-updated)
 * Manual titles are never auto-replaced.
 */
export function canReplaceTitle(conv: Conversation): boolean {
  if (conv.titleSource === 'manual') return false;
  // Allow AI title generation for default (instant-start) and auto (message at creation) titles
  if (conv.titleSource === 'default' || conv.titleSource === 'auto') return true;
  return false;
}

// ─── Favorites (PAN-662) ──────────────────────────────────────────────────────

export type FavoriteType = 'conversation';

/** Return all item IDs that are favorited for the given type. */
export function listFavoritedIds(type: FavoriteType): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT item_id FROM favorites WHERE type = ?`)
    .all(type) as Array<{ item_id: string }>;
  return rows.map((r) => r.item_id);
}

/** Add a favorite. Idempotent — does nothing if already favorited. */
export function setFavorite(type: FavoriteType, itemId: string): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)`,
  ).run(type, itemId, new Date().toISOString());
}

/** Remove a favorite. Idempotent — does nothing if not favorited. */
export function removeFavorite(type: FavoriteType, itemId: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM favorites WHERE type = ? AND item_id = ?`).run(type, itemId);
}

