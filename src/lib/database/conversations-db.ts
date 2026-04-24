/**
 * Conversations SQLite Storage (PAN-416)
 *
 * CRUD operations for the conversations table — session metadata for
 * user-driven Claude conversations spawned from Mission Control.
 */

import { getDatabase } from './index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TitleSource = 'auto' | 'ai' | 'manual';

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
  /** Absolute path to the Claude Code JSONL session file. Null until discovered (PAN-451). */
  sessionFile: string | null;
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
    sessionFile: (row['session_file'] as string | null) ?? null,
    title: (row['title'] as string | null) ?? null,
    titleSource: (row['title_source'] as TitleSource | null) ?? null,
    titleSeed: (row['title_seed'] as string | null) ?? null,
    totalCost: (row['total_cost'] as number) ?? 0,
    archivedAt: (row['archived_at'] as string | null) ?? null,
    model: (row['model'] as string | null) ?? null,
    effort: (row['effort'] as string | null) ?? null,
    forkStatus: (row['fork_status'] as string | null) ?? null,
    forkError: (row['fork_error'] as string | null) ?? null,
  };
}

// ─── Read operations ──────────────────────────────────────────────────────────

export function listConversations(options?: { limit?: number; offset?: number }): Conversation[] {
  const db = getDatabase();
  let sql = `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, session_file, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error
       FROM conversations
       WHERE archived_at IS NULL
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
              created_at, ended_at, last_attached_at, session_file, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error
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
              created_at, ended_at, last_attached_at, session_file, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error
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
              created_at, ended_at, last_attached_at, session_file, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error
       FROM conversations
       WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

export function listArchivedConversations(): Conversation[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, session_file, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error
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
  sessionFile?: string;
  title?: string;
  titleSource?: TitleSource;
  titleSeed?: string;
  model?: string;
  effort?: string;
  forkStatus?: string;
}): Conversation {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO conversations (name, tmux_session, status, cwd, issue_id, created_at, session_file, title, title_source, title_seed, model, effort, fork_status)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.name,
      opts.tmuxSession,
      opts.cwd,
      opts.issueId ?? null,
      now,
      opts.sessionFile ?? null,
      opts.title ?? null,
      opts.titleSource ?? null,
      opts.titleSeed ?? null,
      opts.model ?? null,
      opts.effort ?? null,
      opts.forkStatus ?? null,
    );
  const conv = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at, session_file, title,
              title_source, title_seed, total_cost, archived_at, model, effort,
              fork_status, fork_error
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

/** Store the discovered JSONL session file path for a conversation (PAN-451). */
export function updateSessionFile(name: string, sessionFilePath: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE conversations SET session_file = ? WHERE name = ?`,
  ).run(sessionFilePath, name);
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

/** Update the model for a conversation (used by backfill). */
export function updateConversationModel(name: string, model: string): void {
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
  if (conv.titleSource === 'auto') return true;
  // If AI already set it, don't replace again
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

