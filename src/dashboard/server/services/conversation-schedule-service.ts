/**
 * Conversation schedule sweep (PAN-4640).
 *
 * A dashboard-resident service, started only on the primary dashboard (never
 * a peer, never the deacon child: resume and delivery are in-process calls).
 * Boot +30 s, then every 60 s. Timers are unref()'d and a sweep never overlaps
 * the previous one. The deacon pause toggle does not apply: a scheduled prompt
 * follows the operator-message rule, and conversations are never gated.
 *
 * Each due schedule is claimed before it fires: a compare-and-set advances
 * `next_run_at` to the first occurrence after the current wall clock. Only the
 * caller that wins the claim fires, so a fire is at most once, a crash mid-fire
 * loses that run rather than duplicating it, and a backlog of occurrences
 * missed while the dashboard was down collapses into one fire. A failed fire is
 * recorded and waits for the next occurrence (no retries). A schedule whose
 * conversation is archived is advanced and recorded `skipped`, never fired.
 *
 * Firing resumes the conversation first when its harness is not alive (resume
 * cause `message`), then delivers the prompt like an operator message: Pi
 * harnesses get `follow_up`, every other harness a plain submit. A superseded
 * `/clear` row fires into its chain head. The delivered text starts with a
 * `[Scheduled run · …]` header, which tells the agent why the message arrived
 * and keeps a stored prompt from being routed as a `/pan` composer command.
 */
import {
  claimScheduleRun,
  emitConversationSchedulesChanged,
  listDueSchedules,
  recordScheduleRunOutcome,
  type DueSchedule,
  type ScheduleRunStatus,
} from '../../../lib/overdeck/conversation-schedules.js';
import { nextRunAfter } from '../../../lib/overdeck/conversation-schedule-recurrence.js';
import { getConversationByName, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { isSupersededConversation, resolveClearChainHead } from '../../../lib/overdeck/conversation-clear-chain.js';
import { conversationHarnessAlive } from '../../../lib/overdeck/conversation-liveness.js';
import { invalidateConversationListEnrichmentCache } from '../../../lib/overdeck/conversation-list.js';
import { handleConversationResume } from '../../../lib/overdeck/conversation-runtime.js';
import { handleConversationMessage } from '../../../lib/overdeck/conversation-message.js';
import { clearConversationTriage } from '../../../lib/overdeck/conversation-triage-store.js';
import { isPiControlChannelHarness } from '../../../lib/overdeck/conversation-delivery.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';

const LOG_PREFIX = '[schedules]';

export const SCHEDULE_SWEEP_BOOT_DELAY_MS = 30_000;
export const SCHEDULE_SWEEP_INTERVAL_MS = 60_000;

export type FireOutcome = { ok: true; conversationName: string } | { ok: false; error: string };

export interface ScheduleSweepDeps {
  now: () => number;
  listDue: (now: number) => DueSchedule[];
  claim: (id: number, expectedNextRunAt: number, nextRunAt: number | null, now: number) => boolean;
  record: (id: number, status: ScheduleRunStatus, error: string | null) => void;
  nextRunAfter: (cron: string, timeZone: string, after: Date) => Date | null;
  fire: (schedule: DueSchedule) => Promise<FireOutcome>;
  /** PAN-4657: clears settle/snooze on the delivered-to conversation so it resurfaces in the inbox. */
  clearTriage: (name: string) => boolean;
  /** PAN-4657: tells the dashboard a conversation's schedule state (or its triage) changed. */
  onChanged: (name: string) => void;
}

type HandlerResponse = { status: number; body: unknown };

export interface FireDeps {
  getConversation: (name: string) => LegacyConversation | null;
  harnessAlive: (tmuxSession: string) => Promise<boolean>;
  resume: (name: string) => Promise<HandlerResponse>;
  message: (name: string, body: Record<string, unknown>) => Promise<HandlerResponse>;
}

const defaultFireDeps: FireDeps = {
  getConversation: getConversationByName,
  harnessAlive: (tmuxSession) => conversationHarnessAlive(tmuxSession),
  resume: (name) => handleConversationResume(name, {}, { resolveSessionFile, resumeCause: 'message' }),
  message: (name, body) => handleConversationMessage(name, body, { resolveSessionFile, generateAiTitle: async () => {} }),
};

const defaultSweepDeps: ScheduleSweepDeps = {
  now: () => Date.now(),
  listDue: listDueSchedules,
  claim: claimScheduleRun,
  record: recordScheduleRunOutcome,
  nextRunAfter,
  fire: (schedule) => fireScheduledPrompt(schedule),
  clearTriage: clearConversationTriage,
  onChanged: (name) => {
    invalidateConversationListEnrichmentCache();
    emitConversationSchedulesChanged(name);
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function responseError(response: HandlerResponse): string | null {
  const payload = response.body as { body?: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  try {
    const parsed = text ? (JSON.parse(text) as { error?: unknown }) : null;
    return typeof parsed?.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

export function scheduledPromptText(schedule: Pick<DueSchedule, 'id' | 'cron' | 'timeZone' | 'prompt'>): string {
  return `[Scheduled run · schedule ${schedule.id} · ${schedule.cron} · ${schedule.timeZone}]\n\n${schedule.prompt}`;
}

export async function fireScheduledPrompt(schedule: DueSchedule, deps: FireDeps = defaultFireDeps): Promise<FireOutcome> {
  let conv = deps.getConversation(schedule.conversationName);
  if (!conv) return { ok: false, error: 'conversation not found' };
  if (isSupersededConversation(conv)) {
    conv = resolveClearChainHead(conv);
    if (!conv) return { ok: false, error: 'conversation was cleared and its continuation is unavailable' };
  }
  if (!(await deps.harnessAlive(conv.tmuxSession))) {
    const resumed = await deps.resume(conv.name);
    if (!isSuccess(resumed.status)) {
      return { ok: false, error: `resume failed: ${responseError(resumed) ?? `HTTP ${resumed.status}`}` };
    }
  }
  const delivered = await deps.message(conv.name, {
    message: scheduledPromptText(schedule),
    ...(isPiControlChannelHarness(conv.harness ?? 'claude-code') ? { deliverAs: 'follow_up' } : {}),
  });
  if (isSuccess(delivered.status)) return { ok: true, conversationName: conv.name };
  return { ok: false, error: responseError(delivered) ?? `HTTP ${delivered.status}` };
}

/** One pass over due schedules, sequentially: each fire may spawn a session. */
export async function runScheduleSweepOnce(
  deps: ScheduleSweepDeps = defaultSweepDeps,
): Promise<{ fired: number; failed: number; skipped: number }> {
  const counts = { fired: 0, failed: 0, skipped: 0 };
  const changedNames = new Set<string>();
  for (const schedule of deps.listDue(deps.now())) {
    const at = deps.now();
    const next = deps.nextRunAfter(schedule.cron, schedule.timeZone, new Date(at));
    if (!deps.claim(schedule.id, schedule.nextRunAt, next?.getTime() ?? null, at)) continue;
    changedNames.add(schedule.conversationName);
    if (schedule.archived) {
      deps.record(schedule.id, 'skipped', 'conversation archived');
      counts.skipped++;
      continue;
    }
    let outcome: FireOutcome;
    try {
      outcome = await deps.fire(schedule);
    } catch (error) {
      outcome = { ok: false, error: errorMessage(error) };
    }
    if (outcome.ok) {
      deps.record(schedule.id, 'delivered', null);
      counts.fired++;
      changedNames.add(outcome.conversationName);
      try {
        deps.clearTriage(outcome.conversationName);
      } catch (error) {
        console.warn(`${LOG_PREFIX} clearTriage failed for ${outcome.conversationName}: ${errorMessage(error)}`);
      }
    } else {
      deps.record(schedule.id, 'failed', outcome.error);
      counts.failed++;
      console.warn(`${LOG_PREFIX} schedule ${schedule.id} on ${schedule.conversationName} failed: ${outcome.error}`);
    }
  }
  for (const name of changedNames) deps.onChanged(name);
  return counts;
}

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let stopped = false;
let sweep: () => Promise<{ fired: number; failed: number; skipped: number }> = () => runScheduleSweepOnce();

/** Test seam: replace the sweep the timers run, so no real door runs. */
export function __setScheduleSweepForTests(fn: typeof sweep | null): void {
  sweep = fn ?? (() => runScheduleSweepOnce());
}

async function runGuarded(trigger: string): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    const result = await sweep();
    if (result.fired > 0 || result.failed > 0 || result.skipped > 0) {
      console.log(`${LOG_PREFIX} ${trigger} sweep: ${result.fired} delivered, ${result.failed} failed, ${result.skipped} skipped`);
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${trigger} sweep failed:`, error);
  } finally {
    running = false;
  }
}

export function startConversationScheduleService(): void {
  if (bootTimer !== null || intervalTimer !== null) return;
  stopped = false;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runGuarded('boot');
    intervalTimer = setInterval(() => {
      void runGuarded('interval');
    }, SCHEDULE_SWEEP_INTERVAL_MS);
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();
  }, SCHEDULE_SWEEP_BOOT_DELAY_MS);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();
}

export function stopConversationScheduleService(): void {
  if (bootTimer !== null) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (intervalTimer !== null) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  stopped = true;
}
