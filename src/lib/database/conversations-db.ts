/**
 * Conversations SQLite Storage (PAN-416)
 *
 * CRUD operations for the conversations table — session metadata for
 * user-driven Claude conversations spawned from Mission Control.
 */

import { getDatabase } from './index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

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
  };
}

// ─── Read operations ──────────────────────────────────────────────────────────

export function listConversations(): Conversation[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at
       FROM conversations
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
              created_at, ended_at, last_attached_at
       FROM conversations
       WHERE name = ?`,
    )
    .get(name) as Record<string, unknown> | undefined;
  return row ? rowToConversation(row) : null;
}

// ─── Write operations ─────────────────────────────────────────────────────────

export function createConversation(
  name: string,
  tmuxSession: string,
  cwd: string,
  issueId?: string,
): Conversation {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO conversations (name, tmux_session, status, cwd, issue_id, created_at)
       VALUES (?, ?, 'active', ?, ?, ?)`,
    )
    .run(name, tmuxSession, cwd, issueId ?? null, now);
  const conv = db
    .prepare(
      `SELECT id, name, tmux_session, status, cwd, issue_id,
              created_at, ended_at, last_attached_at
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
