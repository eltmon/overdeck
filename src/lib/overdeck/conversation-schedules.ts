/**
 * Door for conversation schedules (PAN-4640).
 *
 * The only module that reads or writes `conversation_schedules`. A schedule
 * holds one prompt, a 5-field cron and an IANA time zone; the dashboard sweep
 * claims a due row (compare-and-set on `next_run_at`) before it fires, so each
 * occurrence fires at most once. Every name lookup joins `conversations` here
 * so `conversations.ts` never grows (it sits at its file-size cap).
 */

import { getOverdeckDatabase } from './infra.js';
import { isAgentConversationName } from './conversations.js';
import { defaultScheduleTimeZone, nextRunAfter, validateRecurrence } from './conversation-schedule-recurrence.js';
import { getEventStore } from '../../dashboard/server/event-store.js';

export const MAX_SCHEDULES_PER_CONVERSATION = 20;
export const MAX_SCHEDULE_PROMPT_LENGTH = 40_000;
const MAX_RUN_ERROR_LENGTH = 500;

export type ScheduleRunStatus = 'delivered' | 'failed' | 'skipped';

export interface ConversationSchedule {
  id: number;
  conversationName: string;
  conversationTitle: string | null;
  prompt: string;
  cron: string;
  timeZone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: ScheduleRunStatus | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleInput = { prompt: string; cron: string; timeZone: string; enabled: boolean };
export type ScheduleInputResult = { ok: true; value: ScheduleInput } | { ok: false; error: string };
export type SchedulePatchResult = { ok: true; value: Partial<ScheduleInput> } | { ok: false; error: string };

/** Thrown by `updateConversationSchedule` when the merged recurrence is invalid; routes map it to 400. */
export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

function checkPrompt(value: unknown): FieldResult<string> {
  if (typeof value !== 'string') return { ok: false, error: 'prompt is required' };
  const prompt = value.trim();
  if (prompt.length < 1) return { ok: false, error: 'prompt is required' };
  if (prompt.length > MAX_SCHEDULE_PROMPT_LENGTH) {
    return { ok: false, error: `prompt is too long (max ${MAX_SCHEDULE_PROMPT_LENGTH})` };
  }
  return { ok: true, value: prompt };
}

function checkString(value: unknown, field: string): FieldResult<string> {
  if (typeof value !== 'string' || value.trim().length < 1) return { ok: false, error: `${field} must be a non-empty string` };
  return { ok: true, value: value.trim() };
}

function checkEnabled(value: unknown): FieldResult<boolean> {
  if (typeof value !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
  return { ok: true, value };
}

export function validateScheduleInput(
  body: { prompt?: unknown; cron?: unknown; timeZone?: unknown; enabled?: unknown },
  now: number,
): ScheduleInputResult {
  const prompt = checkPrompt(body.prompt);
  if (!prompt.ok) return prompt;
  if (typeof body.cron !== 'string') return { ok: false, error: 'cron is required' };
  const cron = body.cron.trim();
  let timeZone = defaultScheduleTimeZone();
  if (body.timeZone !== undefined) {
    const zone = checkString(body.timeZone, 'timeZone');
    if (!zone.ok) return zone;
    timeZone = zone.value;
  }
  let enabled = true;
  if (body.enabled !== undefined) {
    const flag = checkEnabled(body.enabled);
    if (!flag.ok) return flag;
    enabled = flag.value;
  }
  const recurrence = validateRecurrence(cron, timeZone, new Date(now));
  if (!recurrence.ok) return recurrence;
  return { ok: true, value: { prompt: prompt.value, cron, timeZone, enabled } };
}

/**
 * Type checks for a partial update. When both `cron` and `timeZone` are
 * present the recurrence is validated here; otherwise the update validates the
 * merge with the stored values.
 */
export function validateSchedulePatch(body: Record<string, unknown>, now: number): SchedulePatchResult {
  const value: Partial<ScheduleInput> = {};
  if (body['prompt'] !== undefined) {
    const prompt = checkPrompt(body['prompt']);
    if (!prompt.ok) return prompt;
    value.prompt = prompt.value;
  }
  if (body['cron'] !== undefined) {
    const cron = checkString(body['cron'], 'cron');
    if (!cron.ok) return cron;
    value.cron = cron.value;
  }
  if (body['timeZone'] !== undefined) {
    const zone = checkString(body['timeZone'], 'timeZone');
    if (!zone.ok) return zone;
    value.timeZone = zone.value;
  }
  if (body['enabled'] !== undefined) {
    const flag = checkEnabled(body['enabled']);
    if (!flag.ok) return flag;
    value.enabled = flag.value;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'Provide at least one of prompt, cron, timeZone, enabled' };
  }
  if (value.cron !== undefined && value.timeZone !== undefined) {
    const recurrence = validateRecurrence(value.cron, value.timeZone, new Date(now));
    if (!recurrence.ok) return recurrence;
  }
  return { ok: true, value };
}

interface ScheduleRow {
  id: number;
  conversation_name: string;
  conversation_title: string | null;
  prompt: string;
  cron: string;
  time_zone: string;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_run_status: ScheduleRunStatus | null;
  last_run_error: string | null;
  created_at: number;
  updated_at: number;
}

const SELECT_SCHEDULE = `
  SELECT s.id, c.name AS conversation_name, c.title AS conversation_title, s.prompt, s.cron, s.time_zone,
         s.enabled, s.next_run_at, s.last_run_at, s.last_run_status, s.last_run_error, s.created_at, s.updated_at
  FROM conversation_schedules s
  JOIN conversations c ON c.id = s.conversation_id
`;

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function rowToSchedule(row: ScheduleRow): ConversationSchedule {
  return {
    id: row.id,
    conversationName: row.conversation_name,
    conversationTitle: row.conversation_title,
    prompt: row.prompt,
    cron: row.cron,
    timeZone: row.time_zone,
    enabled: row.enabled === 1,
    nextRunAt: iso(row.next_run_at),
    lastRunAt: iso(row.last_run_at),
    lastRunStatus: row.last_run_status,
    lastRunError: row.last_run_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function computeNextRunAt(cron: string, timeZone: string, now: number): number | null {
  return nextRunAfter(cron, timeZone, new Date(now))?.getTime() ?? null;
}

export type CreateScheduleResult =
  | { status: 'created'; schedule: ConversationSchedule }
  | { status: 'not-found' }
  | { status: 'refused'; code: 'agent-conversation' | 'vault-browse-copy'; error: string }
  | { status: 'limit' };

export function createConversationSchedule(name: string, input: ScheduleInput, now: number = Date.now()): CreateScheduleResult {
  const db = getOverdeckDatabase();
  return db.transaction((): CreateScheduleResult => {
    const conversation = db
      .prepare('SELECT id, name, origin FROM conversations WHERE name = ?')
      .get<{ id: string; name: string; origin: string }>(name);
    if (!conversation) return { status: 'not-found' };
    if (isAgentConversationName(conversation.name)) {
      return { status: 'refused', code: 'agent-conversation', error: 'Schedules cannot be added to agent conversations' };
    }
    if (conversation.origin === 'vault') {
      return { status: 'refused', code: 'vault-browse-copy', error: 'Schedules cannot be added to Session Vault browse copies' };
    }
    const count = db
      .prepare('SELECT COUNT(*) AS count FROM conversation_schedules WHERE conversation_id = ?')
      .get<{ count: number }>(conversation.id);
    if ((count?.count ?? 0) >= MAX_SCHEDULES_PER_CONVERSATION) return { status: 'limit' };
    const nextRunAt = input.enabled ? computeNextRunAt(input.cron, input.timeZone, now) : null;
    const result = db
      .prepare(`
        INSERT INTO conversation_schedules (conversation_id, prompt, cron, time_zone, enabled, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(conversation.id, input.prompt, input.cron, input.timeZone, input.enabled ? 1 : 0, nextRunAt, now, now);
    const row = db.prepare(`${SELECT_SCHEDULE} WHERE s.id = ?`).get<ScheduleRow>(Number(result.lastInsertRowid));
    return { status: 'created', schedule: rowToSchedule(row!) };
  })();
}

export function listConversationSchedules(name: string): ConversationSchedule[] {
  return getOverdeckDatabase()
    .prepare(`${SELECT_SCHEDULE} WHERE c.name = ? ORDER BY s.id`)
    .all<ScheduleRow>(name)
    .map(rowToSchedule);
}

export function listAllConversationSchedules(): ConversationSchedule[] {
  return getOverdeckDatabase()
    .prepare(`${SELECT_SCHEDULE} ORDER BY c.name, s.id`)
    .all<ScheduleRow>()
    .map(rowToSchedule);
}

export function getConversationSchedule(id: number): ConversationSchedule | null {
  const row = getOverdeckDatabase().prepare(`${SELECT_SCHEDULE} WHERE s.id = ?`).get<ScheduleRow>(id);
  return row ? rowToSchedule(row) : null;
}

/**
 * Apply a partial update. A cron or zone change, or re-enabling, recomputes
 * `next_run_at` from `now` (so a pause across a fire time never catches up);
 * disabling or a prompt-only edit keeps it. Returns null when the schedule does
 * not belong to that conversation; throws `ScheduleValidationError` when the
 * merged recurrence is invalid.
 */
export function updateConversationSchedule(
  name: string,
  id: number,
  patch: Partial<ScheduleInput>,
  now: number = Date.now(),
): ConversationSchedule | null {
  const db = getOverdeckDatabase();
  return db.transaction((): ConversationSchedule | null => {
    const current = db.prepare(`${SELECT_SCHEDULE} WHERE s.id = ? AND c.name = ?`).get<ScheduleRow>(id, name);
    if (!current) return null;
    const cron = patch.cron ?? current.cron;
    const timeZone = patch.timeZone ?? current.time_zone;
    const prompt = patch.prompt ?? current.prompt;
    const wasEnabled = current.enabled === 1;
    const enabled = patch.enabled ?? wasEnabled;
    const recurrenceChanged = cron !== current.cron || timeZone !== current.time_zone;
    if (recurrenceChanged) {
      const recurrence = validateRecurrence(cron, timeZone, new Date(now));
      if (!recurrence.ok) throw new ScheduleValidationError(recurrence.error);
    }
    const nextRunAt = enabled && (recurrenceChanged || !wasEnabled)
      ? computeNextRunAt(cron, timeZone, now)
      : current.next_run_at;
    db.prepare(`
      UPDATE conversation_schedules
      SET prompt = ?, cron = ?, time_zone = ?, enabled = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(prompt, cron, timeZone, enabled ? 1 : 0, nextRunAt, now, id);
    const row = db.prepare(`${SELECT_SCHEDULE} WHERE s.id = ?`).get<ScheduleRow>(id);
    return rowToSchedule(row!);
  })();
}

/** Returns true when the schedule existed on that conversation and was removed. */
export function removeConversationSchedule(name: string, id: number): boolean {
  const result = getOverdeckDatabase()
    .prepare(`
      DELETE FROM conversation_schedules
      WHERE id = ? AND conversation_id = (SELECT id FROM conversations WHERE name = ?)
    `)
    .run(id, name);
  return Number(result.changes) > 0;
}

export interface DueSchedule {
  id: number;
  conversationName: string;
  prompt: string;
  cron: string;
  timeZone: string;
  nextRunAt: number;
  archived: boolean;
}

export function listDueSchedules(now: number): DueSchedule[] {
  return getOverdeckDatabase()
    .prepare(`
      SELECT s.id, c.name AS conversation_name, s.prompt, s.cron, s.time_zone, s.next_run_at,
             c.archived_at IS NOT NULL AS archived
      FROM conversation_schedules s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.enabled = 1 AND s.next_run_at IS NOT NULL AND s.next_run_at <= ?
      ORDER BY s.next_run_at, s.id
    `)
    .all<{ id: number; conversation_name: string; prompt: string; cron: string; time_zone: string; next_run_at: number; archived: number }>(now)
    .map((row) => ({
      id: row.id,
      conversationName: row.conversation_name,
      prompt: row.prompt,
      cron: row.cron,
      timeZone: row.time_zone,
      nextRunAt: row.next_run_at,
      archived: row.archived === 1,
    }));
}

/**
 * Compare-and-set claim: advance `next_run_at` only when it still equals the
 * value the sweep read. A null next run disables the schedule. Returns true
 * when this caller won the claim and may fire.
 */
export function claimScheduleRun(id: number, expectedNextRunAt: number, nextRunAt: number | null, now: number): boolean {
  const result = getOverdeckDatabase()
    .prepare(`
      UPDATE conversation_schedules
      SET next_run_at = ?, last_run_at = ?, enabled = CASE WHEN ? IS NULL THEN 0 ELSE enabled END, updated_at = ?
      WHERE id = ? AND next_run_at = ? AND enabled = 1
    `)
    .run(nextRunAt, now, nextRunAt, now, id, expectedNextRunAt);
  return Number(result.changes) === 1;
}

export function recordScheduleRunOutcome(id: number, status: ScheduleRunStatus, error: string | null): void {
  getOverdeckDatabase()
    .prepare('UPDATE conversation_schedules SET last_run_status = ?, last_run_error = ? WHERE id = ?')
    .run(status, error === null ? null : error.slice(0, MAX_RUN_ERROR_LENGTH), id);
}

export interface ConversationScheduleSummary {
  nextScheduledRunAt: string | null;
  scheduleCount: number;
}

export const EMPTY_SCHEDULE_SUMMARY: ConversationScheduleSummary = {
  nextScheduledRunAt: null,
  scheduleCount: 0,
};

/** One query for a page of names (NFR-2). Only enabled schedules count; names with none are absent from the map. */
export function listScheduleSummariesForConversations(names: readonly string[]): Map<string, ConversationScheduleSummary> {
  const byName = new Map<string, ConversationScheduleSummary>();
  if (names.length === 0) return byName;
  const placeholders = names.map(() => '?').join(', ');
  const rows = getOverdeckDatabase()
    .prepare(`
      SELECT c.name AS conversation_name, MIN(s.next_run_at) AS next_run_at, COUNT(*) AS schedule_count
      FROM conversation_schedules s
      JOIN conversations c ON c.id = s.conversation_id
      WHERE s.enabled = 1 AND c.name IN (${placeholders})
      GROUP BY c.name
    `)
    .all<{ conversation_name: string; next_run_at: number | null; schedule_count: number }>(...names);
  for (const row of rows) {
    byName.set(row.conversation_name, { nextScheduledRunAt: iso(row.next_run_at), scheduleCount: row.schedule_count });
  }
  return byName;
}

/** Tell connected clients a conversation's schedules changed. No-op outside the dashboard. */
export function emitConversationSchedulesChanged(conversationName: string): void {
  try {
    getEventStore().emitOnly({
      type: 'conversation.schedules_changed',
      timestamp: new Date().toISOString(),
      payload: { conversationName },
    });
  } catch {
    // Event store is uninitialized in CLI/test contexts; the stored schedule is enough.
  }
}
