/** PAN-4639: operator triage state — settle and snooze — for the conversation list. */
import { getOverdeckDatabase } from './infra.js';

export const SETTLE_REASONS = ['manual', 'merge', 'idle'] as const;
export type SettleReason = (typeof SETTLE_REASONS)[number];

export interface ConversationTriage {
  settledAt: string | null;
  settleReason: SettleReason | null;
  snoozedUntil: string | null;
}

export const EMPTY_CONVERSATION_TRIAGE: ConversationTriage = {
  settledAt: null,
  settleReason: null,
  snoozedUntil: null,
};

export interface TriageUpdate {
  name: string;
  settled?: boolean;
  settleReason?: SettleReason;
  snoozedUntil?: string | null;
}

interface TriageRow {
  settled_at: number | null;
  settle_reason: string | null;
  snoozed_until: number | null;
}

function isSettleReason(value: unknown): value is SettleReason {
  return typeof value === 'string' && (SETTLE_REASONS as readonly string[]).includes(value);
}

function rowToTriage(row: TriageRow): ConversationTriage {
  return {
    settledAt: row.settled_at !== null ? new Date(row.settled_at).toISOString() : null,
    settleReason: row.settled_at !== null ? (isSettleReason(row.settle_reason) ? row.settle_reason : 'manual') : null,
    snoozedUntil: row.snoozed_until !== null ? new Date(row.snoozed_until).toISOString() : null,
  };
}

/** One query for a page of names (NFR-2). Names with no row are absent from the map. */
export function listConversationTriage(names: readonly string[]): Map<string, ConversationTriage> {
  const byName = new Map<string, ConversationTriage>();
  if (names.length === 0) return byName;
  const placeholders = names.map(() => '?').join(', ');
  const rows = getOverdeckDatabase()
    .prepare(`SELECT name, settled_at, settle_reason, snoozed_until FROM conversations WHERE name IN (${placeholders})`)
    .all<TriageRow & { name: string }>(...names);
  for (const row of rows) byName.set(row.name, rowToTriage(row));
  return byName;
}

export function getConversationTriage(name: string): ConversationTriage | null {
  const row = getOverdeckDatabase()
    .prepare('SELECT settled_at, settle_reason, snoozed_until FROM conversations WHERE name = ?')
    .get<TriageRow>(name);
  if (!row) return null;
  return rowToTriage(row);
}

/** Sets settled_at = nowMs unless already settled, settle_reason = reason, snoozed_until = NULL. False when no row. */
export function settleConversation(name: string, reason: SettleReason = 'manual', nowMs: number = Date.now()): boolean {
  const result = getOverdeckDatabase()
    .prepare(
      `UPDATE conversations
       SET settled_at = CASE WHEN settled_at IS NULL THEN ? ELSE settled_at END,
           settle_reason = CASE WHEN settled_at IS NULL THEN ? ELSE settle_reason END,
           snoozed_until = NULL
       WHERE name = ?`,
    )
    .run(nowMs, reason, name);
  return result.changes > 0;
}

export function unsettleConversation(name: string): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET settled_at = NULL, settle_reason = NULL WHERE name = ?')
    .run(name);
  return result.changes > 0;
}

export function snoozeConversation(name: string, untilMs: number): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET snoozed_until = ?, settled_at = NULL, settle_reason = NULL WHERE name = ?')
    .run(untilMs, name);
  return result.changes > 0;
}

export function unsnoozeConversation(name: string): boolean {
  const result = getOverdeckDatabase().prepare('UPDATE conversations SET snoozed_until = NULL WHERE name = ?').run(name);
  return result.changes > 0;
}

/** Parse and validate a request body per the PRD API contract. */
export function parseTriageUpdates(body: unknown): { ok: true; updates: TriageUpdate[] } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || !('updates' in body)) {
    return { ok: false, error: 'updates is required' };
  }
  const { updates } = body as { updates: unknown };
  if (!Array.isArray(updates)) return { ok: false, error: 'updates must be an array' };
  if (updates.length === 0) return { ok: false, error: 'updates must not be empty' };
  if (updates.length > 200) return { ok: false, error: 'updates must not exceed 200 entries' };

  const parsed: TriageUpdate[] = [];
  for (const entry of updates) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, error: 'each update must be an object' };
    const { name, settled, settleReason, snoozedUntil } = entry as Record<string, unknown>;

    if (typeof name !== 'string' || name.trim() === '') return { ok: false, error: 'each update requires a non-empty name' };
    if (settled !== undefined && typeof settled !== 'boolean') return { ok: false, error: 'settled must be a boolean' };
    if (settleReason !== undefined && !isSettleReason(settleReason)) {
      return { ok: false, error: 'settleReason must be manual, merge, or idle' };
    }

    let parsedSnoozedUntil: string | null | undefined;
    if (snoozedUntil !== undefined) {
      if (snoozedUntil === null) {
        parsedSnoozedUntil = null;
      } else if (typeof snoozedUntil === 'string' && !Number.isNaN(Date.parse(snoozedUntil))) {
        parsedSnoozedUntil = snoozedUntil;
      } else {
        return { ok: false, error: 'snoozedUntil must be null or a parseable date string' };
      }
    }

    if (settled === true && parsedSnoozedUntil !== null && parsedSnoozedUntil !== undefined) {
      return { ok: false, error: 'settled cannot be combined with a non-null snoozedUntil' };
    }
    if (settled === undefined && parsedSnoozedUntil === undefined) {
      return { ok: false, error: 'each update requires settled or snoozedUntil' };
    }

    parsed.push({
      name: name.trim(),
      ...(settled !== undefined ? { settled } : {}),
      ...(settleReason !== undefined ? { settleReason } : {}),
      ...(parsedSnoozedUntil !== undefined ? { snoozedUntil: parsedSnoozedUntil } : {}),
    });
  }
  return { ok: true, updates: parsed };
}

/** Apply one validated update (settle/unsettle/snooze/unsnooze per D3). Returns the new state, or null when no row. */
export function applyTriageUpdate(update: TriageUpdate, nowMs: number = Date.now()): ConversationTriage | null {
  let touched = false;

  if (update.snoozedUntil !== undefined) {
    const result =
      update.snoozedUntil === null
        ? unsnoozeConversation(update.name)
        : snoozeConversation(update.name, Date.parse(update.snoozedUntil));
    touched = touched || result;
  }

  if (update.settled !== undefined) {
    const result = update.settled
      ? settleConversation(update.name, update.settleReason ?? 'manual', nowMs)
      : unsettleConversation(update.name);
    touched = touched || result;
  }

  if (!touched) return null;
  return getConversationTriage(update.name);
}
