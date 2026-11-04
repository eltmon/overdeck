/**
 * Door for scheduled conversation messages (PAN-4641 WI-4).
 *
 * The only module that reads or writes `conversation_scheduled_messages`. A
 * scheduled message is an operator message held on the server until its
 * `not_before` instant (a usage-limit reset plus grace), then delivered by the
 * scheduled-messages tick. Rows of one conversation are acted on strictly in
 * `id` order: only the head row (lowest id not yet delivered) ever moves.
 *
 * Status lifecycle: `pending` → `sending` (atomic claim) → `sent` (pasted) →
 * `delivered` (outcome confirmed). A `sent` row that hits the limit again is
 * re-armed back to `pending`. `failed` and `unknown` are terminal until the
 * operator cancels them; `unknown` is never re-pasted automatically.
 */

import { getOverdeckDatabase } from './infra.js';
import { getConversationByName } from './conversations.js';
import { isVaultBrowseConversation } from './conversation-vault-rows.js';
import {
  conversationSupportsScheduledMessages,
  readConversationUsageLimit,
  type ConversationLimitState,
} from './conversation-usage-limit.js';

export const MAX_SCHEDULED_PER_CONVERSATION = 20;
export const MAX_SCHEDULED_ATTEMPTS = 24;
export const RESET_GRACE_MS = 60_000;
export const UNKNOWN_RESET_RETRY_MS = 15 * 60_000;
export const MAX_SCHEDULED_TEXT_LENGTH = 50_000;
const DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type ScheduledMessageStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'failed' | 'unknown';
export type ScheduledResetSource = 'quota-limits' | 'message-text' | 'fallback' | null;

export interface ScheduledMessage {
  id: number;
  conversationName: string;
  text: string;
  status: ScheduledMessageStatus;
  notBefore: string;
  resetSource: ScheduledResetSource;
  limitWindow: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

export interface NotBeforeDecision {
  notBefore: number;
  resetSource: ScheduledResetSource;
  limitWindow: string | null;
}

/** FR-6. Pure. */
export function computeNotBefore(limit: ConversationLimitState | null, now: number): NotBeforeDecision {
  if (limit?.limited && limit.resetsAt) {
    return { notBefore: Date.parse(limit.resetsAt) + RESET_GRACE_MS, resetSource: limit.source, limitWindow: limit.window };
  }
  if (limit?.limited) {
    return { notBefore: now + UNKNOWN_RESET_RETRY_MS, resetSource: 'fallback', limitWindow: limit.window };
  }
  return { notBefore: now, resetSource: null, limitWindow: null };
}

type TextCheck =
  | { ok: true; text: string }
  | { ok: false; code: 'empty' | 'too-long' | 'command-not-schedulable'; error: string };

function checkScheduledText(text: unknown): TextCheck {
  if (typeof text !== 'string' || text.trim().length === 0) return { ok: false, code: 'empty', error: 'message is required' };
  if (text.length > MAX_SCHEDULED_TEXT_LENGTH) {
    return { ok: false, code: 'too-long', error: `message is too long (max ${MAX_SCHEDULED_TEXT_LENGTH})` };
  }
  if (/^\/pan(?:\s|$)/i.test(text.trim())) {
    return { ok: false, code: 'command-not-schedulable', error: '/pan commands cannot be scheduled' };
  }
  return { ok: true, text };
}

interface ScheduledRow {
  id: number;
  conversation_name: string;
  text: string;
  status: ScheduledMessageStatus;
  not_before: number;
  reset_source: ScheduledResetSource;
  limit_window: string | null;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  delivered_at: number | null;
}

const SELECT_ROW = `
  SELECT m.id, c.name AS conversation_name, m.text, m.status, m.not_before, m.reset_source, m.limit_window,
         m.attempts, m.last_error, m.created_at, m.updated_at, m.sent_at, m.delivered_at
  FROM conversation_scheduled_messages m
  JOIN conversations c ON c.id = m.conversation_id`;

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function rowToMessage(row: ScheduledRow): ScheduledMessage {
  return {
    id: row.id,
    conversationName: row.conversation_name,
    text: row.text,
    status: row.status,
    notBefore: new Date(row.not_before).toISOString(),
    resetSource: row.reset_source,
    limitWindow: row.limit_window,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sentAt: isoOrNull(row.sent_at),
    deliveredAt: isoOrNull(row.delivered_at),
  };
}

function getScheduledMessage(id: number): ScheduledMessage | null {
  const row = getOverdeckDatabase().prepare(`${SELECT_ROW} WHERE m.id = ?`).get<ScheduledRow>(id);
  return row ? rowToMessage(row) : null;
}

export type ScheduleResult =
  | { status: 'scheduled'; message: ScheduledMessage; limit: ConversationLimitState | null }
  | { status: 'not-found' }
  | {
      status: 'invalid';
      code: 'empty' | 'too-long' | 'command-not-schedulable' | 'limit-detection-unsupported' | 'vault-browse-copy';
      error: string;
    }
  | { status: 'queue-full' };

export async function scheduleConversationMessage(
  name: string,
  text: unknown,
  deps: { now?: () => number; readUsageLimit?: typeof readConversationUsageLimit } = {},
): Promise<ScheduleResult> {
  const conv = getConversationByName(name);
  if (!conv) return { status: 'not-found' };
  if (isVaultBrowseConversation(conv)) {
    return { status: 'invalid', code: 'vault-browse-copy', error: 'a read-only vault copy cannot receive messages' };
  }
  if (!conversationSupportsScheduledMessages(conv)) {
    return {
      status: 'invalid',
      code: 'limit-detection-unsupported',
      error: 'scheduling is supported only for Claude Code conversations',
    };
  }
  const checked = checkScheduledText(text);
  if (!checked.ok) return { status: 'invalid', code: checked.code, error: checked.error };

  const db = getOverdeckDatabase();
  const countUndelivered = (): number =>
    db.prepare(`
      SELECT COUNT(*) AS count FROM conversation_scheduled_messages
      WHERE conversation_id = (SELECT id FROM conversations WHERE name = ?) AND status != 'delivered'
    `).get<{ count: number }>(name)?.count ?? 0;
  if (countUndelivered() >= MAX_SCHEDULED_PER_CONVERSATION) return { status: 'queue-full' };

  const limit = await (deps.readUsageLimit ?? readConversationUsageLimit)(conv);
  const now = (deps.now ?? Date.now)();
  const next = computeNotBefore(limit, now);
  const id = db.transaction((): number | null => {
    const conversation = db.prepare('SELECT id FROM conversations WHERE name = ?').get<{ id: string }>(name);
    if (!conversation) return null;
    // Re-check under the transaction: the limit read above awaited.
    if (countUndelivered() >= MAX_SCHEDULED_PER_CONVERSATION) return -1;
    const result = db.prepare(`
      INSERT INTO conversation_scheduled_messages
        (conversation_id, text, status, not_before, reset_source, limit_window, attempts, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?)
    `).run(conversation.id, checked.text, next.notBefore, next.resetSource, next.limitWindow, now, now);
    return Number(result.lastInsertRowid);
  })();
  if (id === null) return { status: 'not-found' };
  if (id === -1) return { status: 'queue-full' };
  return { status: 'scheduled', message: getScheduledMessage(id)!, limit };
}

/** A conversation's rows in queue (`id`) order; delivered rows only when asked. */
export function listScheduledMessages(name: string, opts: { includeDelivered?: boolean } = {}): ScheduledMessage[] {
  const filter = opts.includeDelivered ? '' : `AND m.status != 'delivered'`;
  return getOverdeckDatabase()
    .prepare(`${SELECT_ROW} WHERE c.name = ? ${filter} ORDER BY m.id`)
    .all<ScheduledRow>(name)
    .map(rowToMessage);
}

/** Names of unarchived conversations with a row in flight (`sending`/`sent`) or a due `pending` row. */
export function listConversationsWithDueWork(now: number): string[] {
  return getOverdeckDatabase()
    .prepare(`
      SELECT DISTINCT c.name AS name
      FROM conversation_scheduled_messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.archived_at IS NULL
        AND (m.status IN ('sending', 'sent') OR (m.status = 'pending' AND m.not_before <= ?))
      ORDER BY c.name
    `)
    .all<{ name: string }>(now)
    .map((row) => row.name);
}

/** The lowest-id row of a conversation that is not delivered. */
export function headScheduledMessage(name: string): ScheduledMessage | null {
  const row = getOverdeckDatabase()
    .prepare(`${SELECT_ROW} WHERE c.name = ? AND m.status != 'delivered' ORDER BY m.id LIMIT 1`)
    .get<ScheduledRow>(name);
  return row ? rowToMessage(row) : null;
}

/** Atomic `pending → sending`; true only for the single caller that won the row. */
export function claimScheduledMessage(id: number, now: number): boolean {
  const result = getOverdeckDatabase()
    .prepare(`UPDATE conversation_scheduled_messages SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'`)
    .run(now, id);
  return Number(result.changes) > 0;
}

export function markScheduledSent(id: number, now: number): void {
  getOverdeckDatabase()
    .prepare(`UPDATE conversation_scheduled_messages SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, id);
}

export function markScheduledDelivered(id: number, now: number, lastError?: string): void {
  getOverdeckDatabase()
    .prepare(`
      UPDATE conversation_scheduled_messages
      SET status = 'delivered', delivered_at = ?, updated_at = ?, last_error = COALESCE(?, last_error)
      WHERE id = ?
    `)
    .run(now, now, lastError ?? null, id);
}

/** Back to `pending` without counting an attempt (delivery door 409, blocking menu). */
export function releaseScheduledToPending(id: number, now: number, lastError: string, notBefore?: number): void {
  getOverdeckDatabase()
    .prepare(`
      UPDATE conversation_scheduled_messages
      SET status = 'pending', last_error = ?, not_before = COALESCE(?, not_before), updated_at = ?
      WHERE id = ?
    `)
    .run(lastError, notBefore ?? null, now, id);
}

/**
 * Back to `pending` at a new `not_before` (the conversation is limited again).
 * A counted re-arm past MAX_SCHEDULED_ATTEMPTS fails the row instead.
 */
export function rearmScheduledMessage(id: number, now: number, next: NotBeforeDecision, opts: { countAttempt: boolean }): ScheduledMessage {
  const db = getOverdeckDatabase();
  db.transaction(() => {
    const row = db.prepare('SELECT attempts FROM conversation_scheduled_messages WHERE id = ?').get<{ attempts: number }>(id);
    if (!row) return;
    const attempts = row.attempts + (opts.countAttempt ? 1 : 0);
    if (attempts > MAX_SCHEDULED_ATTEMPTS) {
      db.prepare(`
        UPDATE conversation_scheduled_messages SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?
      `).run(`gave up after ${MAX_SCHEDULED_ATTEMPTS} attempts`, now, id);
      return;
    }
    db.prepare(`
      UPDATE conversation_scheduled_messages
      SET status = 'pending', not_before = ?, reset_source = ?, limit_window = ?, attempts = ?, sent_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(next.notBefore, next.resetSource, next.limitWindow, attempts, now, id);
  })();
  return getScheduledMessage(id)!;
}

export function failScheduledMessage(id: number, now: number, status: 'failed' | 'unknown', lastError: string): void {
  getOverdeckDatabase()
    .prepare(`UPDATE conversation_scheduled_messages SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(status, lastError, now, id);
}

/** D6: rows a crash left in `sending` become `unknown` (never re-pasted). Returns the count. */
export function recoverInterruptedScheduledMessages(now: number): number {
  const result = getOverdeckDatabase()
    .prepare(`
      UPDATE conversation_scheduled_messages
      SET status = 'unknown', last_error = 'interrupted while sending', updated_at = ?
      WHERE status = 'sending'
    `)
    .run(now);
  return Number(result.changes);
}

function findRow(name: string, id: number): ScheduledMessage | null {
  const row = getOverdeckDatabase()
    .prepare(`${SELECT_ROW} WHERE c.name = ? AND m.id = ?`)
    .get<ScheduledRow>(name, id);
  return row ? rowToMessage(row) : null;
}

export type EditScheduledResult =
  | { status: 'saved'; message: ScheduledMessage }
  | { status: 'not-found' }
  | { status: 'not-editable' }
  | { status: 'invalid'; error: string };

/** Replaces the text of a `pending` row only. */
export function editScheduledMessage(name: string, id: number, text: unknown, now: number): EditScheduledResult {
  const checked = checkScheduledText(text);
  if (!checked.ok) return { status: 'invalid', error: checked.error };
  const existing = findRow(name, id);
  if (!existing) return { status: 'not-found' };
  const result = getOverdeckDatabase()
    .prepare(`UPDATE conversation_scheduled_messages SET text = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
    .run(checked.text, now, id);
  if (Number(result.changes) === 0) return { status: 'not-editable' };
  return { status: 'saved', message: getScheduledMessage(id)! };
}

export type CancelScheduledResult = { status: 'removed' } | { status: 'not-found' } | { status: 'already-sent' };

/** Deletes a `pending`, `failed` or `unknown` row; a row already pasted cannot be cancelled. */
export function cancelScheduledMessage(name: string, id: number): CancelScheduledResult {
  const existing = findRow(name, id);
  if (!existing) return { status: 'not-found' };
  const result = getOverdeckDatabase()
    .prepare(`DELETE FROM conversation_scheduled_messages WHERE id = ? AND status IN ('pending', 'failed', 'unknown')`)
    .run(id);
  return Number(result.changes) > 0 ? { status: 'removed' } : { status: 'already-sent' };
}

/** Deletes delivered rows older than seven days. Returns the count. */
export function pruneDeliveredScheduledMessages(now: number): number {
  const result = getOverdeckDatabase()
    .prepare(`DELETE FROM conversation_scheduled_messages WHERE status = 'delivered' AND delivered_at < ?`)
    .run(now - DELIVERED_RETENTION_MS);
  return Number(result.changes);
}
