/**
 * Door for conversation bookmarks (PAN-4498).
 *
 * The only module that reads or writes `conversation_bookmarks`. A bookmark is
 * an operator annotation on a transcript message — it is never written to the
 * harness transcript (JSONL or other session files), and it is looked up by
 * stable message id, never by row index or scroll offset.
 */

import { getOverdeckDatabase } from './infra.js';

export interface ConversationBookmark {
  messageId: string;
  label: string;
  messageCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const MAX_BOOKMARKS_PER_CONVERSATION = 500;
export const MAX_BOOKMARK_LABEL_LENGTH = 200;
export const MAX_BOOKMARK_MESSAGE_ID_LENGTH = 256;

export type BookmarkInputResult =
  | { ok: true; messageId: string; label: string; messageCreatedAt: string | null }
  | { ok: false; error: string };

export function validateBookmarkInput(input: {
  messageId: unknown;
  label: unknown;
  messageCreatedAt?: unknown;
}): BookmarkInputResult {
  if (typeof input.messageId !== 'string' || input.messageId.length < 1) {
    return { ok: false, error: 'messageId is required' };
  }
  if (input.messageId.length > MAX_BOOKMARK_MESSAGE_ID_LENGTH) {
    return { ok: false, error: 'messageId is too long' };
  }
  if (input.messageId.startsWith('optimistic-')) {
    return { ok: false, error: 'optimistic messages cannot be bookmarked' };
  }
  if (typeof input.label !== 'string') {
    return { ok: false, error: 'label is required' };
  }
  const label = input.label.trim();
  if (label.length < 1) {
    return { ok: false, error: 'label is required' };
  }
  if (label.length > MAX_BOOKMARK_LABEL_LENGTH) {
    return { ok: false, error: 'label is too long (max 200)' };
  }
  let messageCreatedAt: string | null = null;
  if (input.messageCreatedAt !== undefined && input.messageCreatedAt !== null) {
    if (typeof input.messageCreatedAt !== 'string' || Number.isNaN(Date.parse(input.messageCreatedAt))) {
      return { ok: false, error: 'messageCreatedAt must be an ISO timestamp' };
    }
    messageCreatedAt = input.messageCreatedAt;
  }
  return { ok: true, messageId: input.messageId, label, messageCreatedAt };
}

interface BookmarkRow {
  message_id: string;
  label: string;
  message_created_at: string | null;
  created_at: number;
  updated_at: number;
}

function rowToBookmark(row: BookmarkRow): ConversationBookmark {
  return {
    messageId: row.message_id,
    label: row.label,
    messageCreatedAt: row.message_created_at,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** All bookmarks for a conversation, ordered by message time (nulls last) then creation order. */
export function listConversationBookmarks(name: string): ConversationBookmark[] {
  return getOverdeckDatabase()
    .prepare(`
      SELECT b.message_id, b.label, b.message_created_at, b.created_at, b.updated_at
      FROM conversation_bookmarks b
      JOIN conversations c ON c.id = b.conversation_id
      WHERE c.name = ?
      ORDER BY b.message_created_at IS NULL, b.message_created_at, b.created_at
    `)
    .all<BookmarkRow>(name)
    .map(rowToBookmark);
}

export type UpsertBookmarkResult =
  | { status: 'saved'; bookmark: ConversationBookmark }
  | { status: 'not-found' }
  | { status: 'limit' };

/**
 * Create or rename a bookmark. Renaming keeps the original `createdAt`; the
 * 500-per-conversation cap (NFR-4) only blocks a genuinely new messageId —
 * renaming an existing bookmark always succeeds.
 */
export function upsertConversationBookmark(
  name: string,
  input: { messageId: string; label: string; messageCreatedAt: string | null },
  now: number = Date.now(),
): UpsertBookmarkResult {
  const db = getOverdeckDatabase();
  return db.transaction((): UpsertBookmarkResult => {
    const conversation = db.prepare('SELECT id FROM conversations WHERE name = ?').get<{ id: string }>(name);
    if (!conversation) return { status: 'not-found' };
    const existing = db
      .prepare('SELECT 1 FROM conversation_bookmarks WHERE conversation_id = ? AND message_id = ?')
      .get(conversation.id, input.messageId);
    if (!existing) {
      const count = db
        .prepare('SELECT COUNT(*) AS count FROM conversation_bookmarks WHERE conversation_id = ?')
        .get<{ count: number }>(conversation.id);
      if ((count?.count ?? 0) >= MAX_BOOKMARKS_PER_CONVERSATION) return { status: 'limit' };
    }
    db.prepare(`
      INSERT INTO conversation_bookmarks (conversation_id, message_id, label, message_created_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, message_id) DO UPDATE SET
        label = excluded.label,
        message_created_at = COALESCE(excluded.message_created_at, conversation_bookmarks.message_created_at),
        updated_at = excluded.updated_at
    `).run(conversation.id, input.messageId, input.label, input.messageCreatedAt, now, now);
    const row = db
      .prepare('SELECT message_id, label, message_created_at, created_at, updated_at FROM conversation_bookmarks WHERE conversation_id = ? AND message_id = ?')
      .get<BookmarkRow>(conversation.id, input.messageId);
    return { status: 'saved', bookmark: rowToBookmark(row!) };
  })();
}

/** Returns true when a row existed and was removed. */
export function removeConversationBookmark(name: string, messageId: string): boolean {
  const result = getOverdeckDatabase()
    .prepare(`
      DELETE FROM conversation_bookmarks
      WHERE conversation_id = (SELECT id FROM conversations WHERE name = ?) AND message_id = ?
    `)
    .run(name, messageId);
  return Number(result.changes) > 0;
}
