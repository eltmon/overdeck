/**
 * pan conversations schedule add / list / pause / resume / rm (PAN-4640) —
 * run a prompt in a conversation on a recurring schedule. The dashboard sweep
 * fires it, so it survives harness and dashboard restarts.
 *
 * <conv> is `self` (also `.`, `current`, `me`), a conversation number (the
 * /conv/<n> id), an exact name, or a unique title match. Writes call the
 * dashboard routes; with the dashboard down they go through the door directly.
 * `list` always reads the door in-process.
 *
 * Exit codes: 0 ok; 1 invalid input, refused, or error; 2 conversation or
 * schedule not found.
 */

import { readFile } from 'node:fs/promises';
import chalk from 'chalk';

import { exitCli } from '../../exit.js';
import { getDashboardApiUrl } from '../../../lib/config.js';
import { resolveCurrentConversation } from '../../../lib/conversations/current.js';
import { getConversationById } from '../../../lib/overdeck/conversations.js';
import {
  createConversationSchedule,
  getConversationSchedule,
  listAllConversationSchedules,
  listConversationSchedules,
  MAX_SCHEDULES_PER_CONVERSATION,
  removeConversationSchedule,
  ScheduleValidationError,
  updateConversationSchedule,
  validateScheduleInput,
  validateSchedulePatch,
  type ConversationSchedule,
} from '../../../lib/overdeck/conversation-schedules.js';
import { defaultScheduleTimeZone, presetToCron } from '../../../lib/overdeck/conversation-schedule-recurrence.js';
import { resolveConversation } from './move.js';

export interface ScheduleAddOptions {
  cron?: string;
  hourly?: boolean;
  daily?: string;
  weekdays?: string;
  weekly?: string;
  prompt?: string;
  promptFile?: string;
  tz?: string;
  paused?: boolean;
  json?: boolean;
}

type ApiResult<T> = { ok: boolean; status: number; body: T | { error: string; code?: string } };

const SELF_ALIASES = new Set(['self', '.', 'current', 'me']);

function isConnectionRefused(error: unknown): boolean {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  return Boolean(cause && typeof cause === 'object' && 'code' in cause && (cause as { code?: unknown }).code === 'ECONNREFUSED');
}

/** Dashboard route first; the in-process door when the dashboard is down. */
async function viaDashboard<T>(path: string, init: RequestInit, offline: () => ApiResult<T>): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${getDashboardApiUrl()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await response.json() as T | { error: string; code?: string };
    return { ok: response.ok, status: response.status, body };
  } catch (error: unknown) {
    if (!isConnectionRefused(error)) throw error;
    return offline();
  }
}

async function fail(message: string, code: 1 | 2): Promise<never> {
  console.error(chalk.red(`Error: ${message}`));
  return exitCli(code);
}

async function failWith(status: number, body: { error?: string }): Promise<never> {
  return fail(body.error ?? 'request failed', status === 404 ? 2 : 1);
}

async function resolveConversationName(query: string): Promise<string> {
  if (SELF_ALIASES.has(query.toLowerCase())) {
    const current = await resolveCurrentConversation();
    if (!current) return fail('Not running inside an Overdeck conversation', 2);
    return current.name;
  }
  if (/^\d+$/.test(query)) {
    const byId = getConversationById(Number(query));
    if (!byId) return fail(`No conversation #${query}`, 2);
    return byId.name;
  }
  const { conversation, candidates } = resolveConversation(query);
  if (conversation) return conversation.name;
  if (candidates.length === 0) {
    console.error(chalk.red(`No conversation found matching "${query}"`));
  } else {
    console.error(chalk.red(`Ambiguous match for "${query}" — ${candidates.length} candidates:`));
    for (const c of candidates) console.error(chalk.dim(`  ${c.name}  ${c.title ?? '(untitled)'}`));
  }
  return exitCli(2);
}

async function cronFromOptions(opts: ScheduleAddOptions): Promise<string> {
  const chosen = [opts.cron !== undefined, opts.hourly === true, opts.daily !== undefined, opts.weekdays !== undefined, opts.weekly !== undefined]
    .filter(Boolean).length;
  if (chosen !== 1) return fail('Pass exactly one of --cron, --hourly, --daily, --weekdays, --weekly', 1);
  try {
    if (opts.cron !== undefined) return opts.cron;
    if (opts.hourly) return presetToCron({ kind: 'hourly' });
    if (opts.daily !== undefined) return presetToCron({ kind: 'daily', time: opts.daily });
    if (opts.weekdays !== undefined) return presetToCron({ kind: 'weekdays', time: opts.weekdays });
    const parts = (opts.weekly ?? '').trim().split(/\s+/);
    if (parts.length !== 2) return fail('--weekly expects "<day> HH:MM", e.g. "mon 09:00"', 1);
    return presetToCron({ kind: 'weekly', day: parts[0]!, time: parts[1]! });
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : String(error), 1);
  }
}

async function promptFromOptions(opts: ScheduleAddOptions): Promise<string> {
  if ((opts.prompt !== undefined) === (opts.promptFile !== undefined)) {
    return fail('Pass exactly one of --prompt, --prompt-file', 1);
  }
  if (opts.prompt !== undefined) return opts.prompt;
  try {
    return await readFile(opts.promptFile!, 'utf8');
  } catch (error: unknown) {
    return fail(`Cannot read --prompt-file: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}

/** `YYYY-MM-DD HH:mm TZ` in the schedule's own zone. */
export function formatScheduleTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

function offlineCreate(name: string, body: Record<string, unknown>): ApiResult<{ schedule: ConversationSchedule }> {
  const now = Date.now();
  const validated = validateScheduleInput(body, now);
  if (!validated.ok) return { ok: false, status: 400, body: { error: validated.error } };
  const result = createConversationSchedule(name, validated.value, now);
  switch (result.status) {
    case 'created':
      return { ok: true, status: 201, body: { schedule: result.schedule } };
    case 'not-found':
      return { ok: false, status: 404, body: { error: 'Conversation not found' } };
    case 'refused':
      return { ok: false, status: 409, body: { error: result.error, code: result.code } };
    case 'limit':
      return { ok: false, status: 409, body: { error: `Schedule limit reached (${MAX_SCHEDULES_PER_CONVERSATION})`, code: 'limit' } };
  }
}

function offlinePatch(name: string, id: number, body: Record<string, unknown>): ApiResult<{ schedule: ConversationSchedule }> {
  const now = Date.now();
  const validated = validateSchedulePatch(body, now);
  if (!validated.ok) return { ok: false, status: 400, body: { error: validated.error } };
  try {
    const schedule = updateConversationSchedule(name, id, validated.value, now);
    if (!schedule) return { ok: false, status: 404, body: { error: 'Schedule not found' } };
    return { ok: true, status: 200, body: { schedule } };
  } catch (error: unknown) {
    if (error instanceof ScheduleValidationError) return { ok: false, status: 400, body: { error: error.message } };
    throw error;
  }
}

export async function scheduleAddAction(conv: string, opts: ScheduleAddOptions): Promise<void> {
  const name = await resolveConversationName(conv);
  const cron = await cronFromOptions(opts);
  const prompt = await promptFromOptions(opts);
  const body = { prompt, cron, timeZone: opts.tz ?? defaultScheduleTimeZone(), enabled: !opts.paused };
  const result = await viaDashboard<{ schedule: ConversationSchedule }>(
    `/api/conversations/${encodeURIComponent(name)}/schedules`,
    { method: 'POST', body: JSON.stringify(body) },
    () => offlineCreate(name, body),
  );
  if (!result.ok) return failWith(result.status, result.body as { error?: string });
  const { schedule } = result.body as { schedule: ConversationSchedule };
  if (opts.json) {
    console.log(JSON.stringify(schedule, null, 2));
    return;
  }
  const when = schedule.enabled ? `next run ${formatScheduleTime(schedule.nextRunAt, schedule.timeZone)}` : 'paused';
  console.log(chalk.green(`✓ Schedule ${schedule.id} on ${schedule.conversationName}: ${schedule.cron} (${schedule.timeZone}) — ${when}`));
}

export async function scheduleListAction(conv: string | undefined, opts: { json?: boolean } = {}): Promise<void> {
  const schedules = conv === undefined
    ? listAllConversationSchedules()
    : listConversationSchedules(await resolveConversationName(conv));
  if (opts.json) {
    console.log(JSON.stringify(schedules, null, 2));
    return;
  }
  if (schedules.length === 0) {
    console.log(chalk.dim('No schedules'));
    return;
  }
  for (const s of schedules) {
    const next = s.enabled ? formatScheduleTime(s.nextRunAt, s.timeZone) : '—';
    console.log(`${s.id}  ${s.conversationName}  ${s.cron}  ${s.timeZone}  next ${next}  last ${s.lastRunStatus ?? '—'}  ${s.enabled ? 'enabled' : 'paused'}`);
    if (s.lastRunStatus === 'failed' && s.lastRunError) console.log(chalk.dim(`    ${s.lastRunError}`));
  }
}

async function scheduleOrExit(idArg: string): Promise<ConversationSchedule> {
  if (!/^\d+$/.test(idArg)) return fail(`Invalid schedule id: ${idArg}`, 1);
  const schedule = getConversationSchedule(Number(idArg));
  if (!schedule) return fail(`Schedule ${idArg} not found`, 2);
  return schedule;
}

export async function scheduleSetEnabledAction(idArg: string, enabled: boolean): Promise<void> {
  const current = await scheduleOrExit(idArg);
  const name = current.conversationName;
  const result = await viaDashboard<{ schedule: ConversationSchedule }>(
    `/api/conversations/${encodeURIComponent(name)}/schedules/${current.id}`,
    { method: 'PATCH', body: JSON.stringify({ enabled }) },
    () => offlinePatch(name, current.id, { enabled }),
  );
  if (!result.ok) return failWith(result.status, result.body as { error?: string });
  const { schedule } = result.body as { schedule: ConversationSchedule };
  console.log(chalk.green(enabled
    ? `✓ Resumed schedule ${schedule.id} on ${name} — next run ${formatScheduleTime(schedule.nextRunAt, schedule.timeZone)}`
    : `✓ Paused schedule ${schedule.id} on ${name}`));
}

export async function scheduleRemoveAction(idArg: string): Promise<void> {
  const current = await scheduleOrExit(idArg);
  const name = current.conversationName;
  const result = await viaDashboard<{ removed: true }>(
    `/api/conversations/${encodeURIComponent(name)}/schedules/${current.id}`,
    { method: 'DELETE' },
    () => removeConversationSchedule(name, current.id)
      ? { ok: true, status: 200, body: { removed: true } }
      : { ok: false, status: 404, body: { error: 'Schedule not found' } },
  );
  if (!result.ok) return failWith(result.status, result.body as { error?: string });
  console.log(chalk.green(`✓ Removed schedule ${current.id} from ${name}`));
}
