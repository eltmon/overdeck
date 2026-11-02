/** PAN-4639: operator triage state — settle and snooze — for the conversation list. */
import { getOverdeckDatabase } from './infra.js';

export const SETTLE_REASONS = ['manual', 'merge', 'idle'] as const;
export type SettleReason = (typeof SETTLE_REASONS)[number];

export const AUTO_SETTLE_OVERRIDES = ['on', 'off', 'inherit'] as const;
export type AutoSettleOverride = (typeof AUTO_SETTLE_OVERRIDES)[number];

export interface ConversationTriage {
  settledAt: string | null;
  settleReason: SettleReason | null;
  snoozedUntil: string | null;
  /** PAN-4653: per-conversation auto-settle-on-merge override. */
  autoSettleOverride: AutoSettleOverride;
}

export const EMPTY_CONVERSATION_TRIAGE: ConversationTriage = {
  settledAt: null,
  settleReason: null,
  snoozedUntil: null,
  autoSettleOverride: 'inherit',
};

export interface TriageUpdate {
  name: string;
  settled?: boolean;
  settleReason?: SettleReason;
  snoozedUntil?: string | null;
  autoSettleOverride?: AutoSettleOverride;
}

interface TriageRow {
  settled_at: number | null;
  settle_reason: string | null;
  snoozed_until: number | null;
  auto_settle_override: string | null;
}

function isSettleReason(value: unknown): value is SettleReason {
  return typeof value === 'string' && (SETTLE_REASONS as readonly string[]).includes(value);
}

function isAutoSettleOverride(value: unknown): value is AutoSettleOverride {
  return typeof value === 'string' && (AUTO_SETTLE_OVERRIDES as readonly string[]).includes(value);
}

function rowToTriage(row: TriageRow): ConversationTriage {
  return {
    settledAt: row.settled_at !== null ? new Date(row.settled_at).toISOString() : null,
    settleReason: row.settled_at !== null ? (isSettleReason(row.settle_reason) ? row.settle_reason : 'manual') : null,
    snoozedUntil: row.snoozed_until !== null ? new Date(row.snoozed_until).toISOString() : null,
    autoSettleOverride:
      row.auto_settle_override === 'on' || row.auto_settle_override === 'off' ? row.auto_settle_override : 'inherit',
  };
}

/** One query for a page of names (NFR-2). Names with no row are absent from the map. */
export function listConversationTriage(names: readonly string[]): Map<string, ConversationTriage> {
  const byName = new Map<string, ConversationTriage>();
  if (names.length === 0) return byName;
  const placeholders = names.map(() => '?').join(', ');
  const rows = getOverdeckDatabase()
    .prepare(`SELECT name, settled_at, settle_reason, snoozed_until, auto_settle_override FROM conversations WHERE name IN (${placeholders})`)
    .all<TriageRow & { name: string }>(...names);
  for (const row of rows) byName.set(row.name, rowToTriage(row));
  return byName;
}

export function getConversationTriage(name: string): ConversationTriage | null {
  const row = getOverdeckDatabase()
    .prepare('SELECT settled_at, settle_reason, snoozed_until, auto_settle_override FROM conversations WHERE name = ?')
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

/** Clears the settle and restarts the idle clock (PAN-4655 D3). */
export function unsettleConversation(name: string, nowMs: number = Date.now()): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET settled_at = NULL, settle_reason = NULL, idle_reset_at = ? WHERE name = ?')
    .run(nowMs, name);
  return result.changes > 0;
}

export function snoozeConversation(name: string, untilMs: number): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET snoozed_until = ?, settled_at = NULL, settle_reason = NULL WHERE name = ?')
    .run(untilMs, name);
  return result.changes > 0;
}

/** Clears the snooze and restarts the idle clock (PAN-4655 D3). */
export function unsnoozeConversation(name: string, nowMs: number = Date.now()): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET snoozed_until = NULL, idle_reset_at = ? WHERE name = ?')
    .run(nowMs, name);
  return result.changes > 0;
}

/** PAN-4657: clears settle and snooze together and restarts the idle clock (PAN-4655 D3), so a schedule delivering a prompt resurfaces the conversation. */
export function clearConversationTriage(name: string, nowMs: number = Date.now()): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET settled_at = NULL, settle_reason = NULL, snoozed_until = NULL, idle_reset_at = ? WHERE name = ?')
    .run(nowMs, name);
  return result.changes > 0;
}

export interface IdleClock {
  settledAtMs: number | null;
  snoozedUntilMs: number | null;
  idleResetAtMs: number | null;
}

/** PAN-4655: idle-clock inputs for every unarchived conversation, one query. */
export function listIdleClocks(): Map<string, IdleClock> {
  const rows = getOverdeckDatabase()
    .prepare('SELECT name, settled_at, snoozed_until, idle_reset_at FROM conversations WHERE archived_at IS NULL')
    .all<{ name: string; settled_at: number | null; snoozed_until: number | null; idle_reset_at: number | null }>();
  const byName = new Map<string, IdleClock>();
  for (const row of rows) {
    byName.set(row.name, {
      settledAtMs: row.settled_at,
      snoozedUntilMs: row.snoozed_until,
      idleResetAtMs: row.idle_reset_at,
    });
  }
  return byName;
}

/** PAN-4655 D7: settle as 'idle' only if nothing the operator did since cutoffMs says otherwise. */
export function settleIdleConversation(name: string, cutoffMs: number, nowMs: number = Date.now()): boolean {
  const result = getOverdeckDatabase()
    .prepare(
      `UPDATE conversations
       SET settled_at = ?, settle_reason = 'idle', snoozed_until = NULL
       WHERE name = ? AND archived_at IS NULL AND settled_at IS NULL
         AND (snoozed_until IS NULL OR snoozed_until <= ?)
         AND (idle_reset_at IS NULL OR idle_reset_at <= ?)`,
    )
    .run(nowMs, name, cutoffMs, cutoffMs);
  return result.changes > 0;
}

/** PAN-4653: 'inherit' stores NULL. False when no row. */
export function setAutoSettleOverride(name: string, override: AutoSettleOverride): boolean {
  const result = getOverdeckDatabase()
    .prepare('UPDATE conversations SET auto_settle_override = ? WHERE name = ?')
    .run(override === 'inherit' ? null : override, name);
  return result.changes > 0;
}

/** PAN-4653 D4: whether the merge sweep settles a conversation. */
export function autoSettlesOnMerge(override: AutoSettleOverride, globalEnabled: boolean): boolean {
  return override === 'inherit' ? globalEnabled : override === 'on';
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
    const { name, settled, settleReason, snoozedUntil, autoSettleOverride } = entry as Record<string, unknown>;

    if (typeof name !== 'string' || name.trim() === '') return { ok: false, error: 'each update requires a non-empty name' };
    if (settled !== undefined && typeof settled !== 'boolean') return { ok: false, error: 'settled must be a boolean' };
    if (settleReason !== undefined && !isSettleReason(settleReason)) {
      return { ok: false, error: 'settleReason must be manual, merge, or idle' };
    }
    if (autoSettleOverride !== undefined && !isAutoSettleOverride(autoSettleOverride)) {
      return { ok: false, error: 'autoSettleOverride must be on, off, or inherit' };
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
    if (settled === undefined && parsedSnoozedUntil === undefined && autoSettleOverride === undefined) {
      return { ok: false, error: 'each update requires settled, snoozedUntil, or autoSettleOverride' };
    }

    parsed.push({
      name: name.trim(),
      ...(settled !== undefined ? { settled } : {}),
      ...(settleReason !== undefined ? { settleReason } : {}),
      ...(parsedSnoozedUntil !== undefined ? { snoozedUntil: parsedSnoozedUntil } : {}),
      ...(autoSettleOverride !== undefined ? { autoSettleOverride } : {}),
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
        ? unsnoozeConversation(update.name, nowMs)
        : snoozeConversation(update.name, Date.parse(update.snoozedUntil));
    touched = touched || result;
  }

  if (update.settled !== undefined) {
    const result = update.settled
      ? settleConversation(update.name, update.settleReason ?? 'manual', nowMs)
      : unsettleConversation(update.name, nowMs);
    touched = touched || result;
  }

  if (update.autoSettleOverride !== undefined) touched = setAutoSettleOverride(update.name, update.autoSettleOverride) || touched;

  if (!touched) return null;
  return getConversationTriage(update.name);
}
