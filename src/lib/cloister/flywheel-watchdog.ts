/**
 * watchFlywheelLoop (PAN-5667): the deacon-lite routine that keeps the
 * Flywheel loop ticking.
 *
 * The `pan-flywheel` skill schedules its next tick with a background
 * `sleep 450` inside its own conversation. When Claude Code kills that timer
 * (it does under memory pressure), the conversation goes idle with no next
 * turn and the loop stops until someone types into it. This routine is the
 * outside wake-up. It reads only derived facts: the conversation row, the
 * session's liveness, the transcript's newest tick marker, and the host boot
 * time. It stores nothing outside this process's memory.
 *
 * **Nudge.** When the flywheel run is `running` (row active, session alive),
 * its newest tick is older than `FLYWHEEL_FRESHNESS_BREATHING_MS` (20 min),
 * and the conversation is at a turn boundary, deliver `/pan-flywheel` through
 * the agent delivery door (the `pan tell` path). A turn boundary needs
 * positive evidence: the transcript's last non-system message is an assistant
 * message with a terminal `completedAt` and no tool call waits on its result
 * (an AskUserQuestion or a permission prompt is such a tool call). The deacon
 * child has no runtime mirror, so the transcript is the proof here; on Herdr,
 * the pane state from `isAlive` (`working`, `blocked`) vetoes a nudge as well.
 * A missing or unreadable transcript, no tick at all, or a `phase=stopping`
 * tick means no nudge. One stall gets one nudge: the same tick is nudged again
 * only after another 20 minutes.
 *
 * **Resume after a reboot.** When the run is `paused` because the host
 * rebooted under a running loop, resume it with `resumeFlywheel`, which keeps
 * the run's context and re-sends `/pan-flywheel`. "Rebooted under a running
 * loop" needs every one of these:
 *
 * 1. The boot is not `--no-resume` (`OVERDECK_NO_RESUME=1`).
 * 2. The row was created before the boot and is not mid-fork.
 * 3. The row did not end before the boot: it is still `active`, or its
 *    `ended_at` is at or after the boot (the conversation lifecycle sweep ends
 *    a dead row after the dashboard starts). A row ended before the boot was
 *    paused, stopped, or drained on purpose, so it stays paused.
 * 4. Nothing was written to the transcript since the boot. A resume writes a
 *    record at once, so a loop that was resumed and then paused by the
 *    operator is never resumed again, even across a dashboard restart.
 * 5. The newest tick is not `phase=stopping` (a graceful `pan flywheel stop`).
 * 6. The dashboard has recorded no deliberate stop of the conversation since
 *    the boot (`conversation-stop-marks.ts`). The stop marks live in the
 *    dashboard process, so the resume goes through `POST /api/flywheel/resume`
 *    with the internal token and `unlessStoppedSince`; the route checks the
 *    marks and refuses with 409 `FlywheelStoppedOnPurpose`.
 *
 * A failed resume is retried every `FLYWHEEL_RESUME_RETRY_MS`, at most
 * `FLYWHEEL_RESUME_MAX_ATTEMPTS` times per deacon process. A refusal ends the
 * attempts.
 *
 * Every nudge and resume goes to the dashboard activity feed
 * (`emitActivityEntry`) and, as a returned action line, to deacon.log. The
 * deacon's global pause stops this routine with the rest of the patrol.
 * `flywheel.globally_paused` is not read: emergency stop sets it and nothing
 * clears it, so gating on it would turn the watchdog off for good.
 */
import { uptime } from 'node:os';

import { emitActivityEntry } from '../activity-logger.js';
import { isAlive } from '../agents/liveness.js';
import { deliverAgentMessage } from '../agents/delivery.js';
import { isNoResumeValueEnabled } from '../boot-no-resume.js';
import { getInternalToken, INTERNAL_TOKEN_HEADER } from '../internal-token.js';
import {
  FLYWHEEL_CONVERSATION_SESSION,
  FLYWHEEL_FRESHNESS_BREATHING_MS,
  FLYWHEEL_SKILL_COMMAND,
} from '../flywheel/constants.js';
import type { FlywheelRunRead } from '../flywheel/derive-status.js';
import { findLastTick, type TickMarkerMessage } from '../flywheel/tick-marker.js';
import type { LegacyConversation } from '../overdeck/conversations.js';
import type { RuntimeName } from '../runtimes/types.js';

/** How long a failed reboot resume waits before the next attempt. */
export const FLYWHEEL_RESUME_RETRY_MS = 5 * 60_000;
/** Reboot resume attempts per deacon process. */
export const FLYWHEEL_RESUME_MAX_ATTEMPTS = 3;

const ROUTINE = 'watchFlywheelLoop';
const CALLER = `deacon-lite:${ROUTINE}`;

/** What the routine reads from the flywheel transcript. */
export interface FlywheelTranscriptRead {
  /** Oldest first. */
  messages: readonly TickMarkerMessage[];
  /** True only when the transcript proves the last turn ended (see the module header). */
  atTurnBoundary: boolean;
}

/** `busy` vetoes a nudge; `idle` and `unknown` leave the decision to the transcript. */
export type FlywheelPaneState = 'busy' | 'idle' | 'unknown';

/** Outcome of a reboot resume request. */
export type FlywheelResumeOutcome =
  | { kind: 'resumed' }
  | { kind: 'already-running' }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; reason: string };

export interface FlywheelWatchdogDeps {
  readRun: () => Promise<Pick<FlywheelRunRead, 'conv' | 'run'>>;
  /** Null when the transcript cannot be found or read. */
  readTranscript: (conv: LegacyConversation) => Promise<FlywheelTranscriptRead | null>;
  paneState: (conv: LegacyConversation) => Promise<FlywheelPaneState>;
  /** Delivers `/pan-flywheel` to the running loop; throws when it is not delivered. */
  nudge: () => Promise<void>;
  /** Resumes the paused loop unless it was stopped on purpose at or after `sinceMs`. */
  resume: (sinceMs: number) => Promise<FlywheelResumeOutcome>;
  isNoResumeBoot: () => boolean;
  /** When this host booted, in epoch ms. */
  bootTimeMs: () => number;
  /** The dashboard activity feed. */
  log: (message: string, level: 'info' | 'warn') => void;
  now: () => number;
}

// ============================================================================
// Default deps
// ============================================================================

async function defaultReadTranscript(conv: LegacyConversation): Promise<FlywheelTranscriptRead | null> {
  const { resolveSessionFile } = await import('../overdeck/conversation-reads.js');
  const file = await resolveSessionFile(conv).catch(() => null);
  return file ? readWatchdogTranscriptFile(file) : null;
}

/** Parses one transcript file through the conversation reader. Null when it cannot be read. */
export async function readWatchdogTranscriptFile(file: string): Promise<FlywheelTranscriptRead | null> {
  const { getCachedMessages } = await import('../overdeck/conversation-reads.js');
  try {
    const parsed = await getCachedMessages(file, false);
    let last: (typeof parsed.messages)[number] | undefined;
    for (let i = parsed.messages.length - 1; i >= 0 && !last; i -= 1) {
      const message = parsed.messages[i];
      if (message && message.role !== 'system') last = message;
    }
    const atTurnBoundary = parsed.pendingToolUse.size === 0
      && last?.role === 'assistant'
      && Boolean(last.completedAt)
      && !last.streaming;
    return { messages: parsed.messages, atTurnBoundary };
  } catch {
    return null;
  }
}

async function defaultPaneState(conv: LegacyConversation): Promise<FlywheelPaneState> {
  const harness: RuntimeName = conv.harness ?? 'claude-code';
  const verdict = await isAlive(conv.tmuxSession, { readHarness: () => harness }).catch(() => null);
  if (!verdict?.alive) return 'unknown';
  if (verdict.backendState === 'working' || verdict.backendState === 'blocked') return 'busy';
  if (verdict.backendState === 'idle' || verdict.backendState === 'done') return 'idle';
  return 'unknown';
}

async function defaultNudge(): Promise<void> {
  const delivery = await deliverAgentMessage(FLYWHEEL_CONVERSATION_SESSION, FLYWHEEL_SKILL_COMMAND, CALLER);
  if (!delivery.ok) throw new Error(delivery.failure ?? delivery.path);
}

function internalDashboardOrigin(): string {
  const port = Number.parseInt(process.env['API_PORT'] ?? process.env['PORT'] ?? '3011', 10);
  return process.env['OVERDECK_INTERNAL_DASHBOARD_URL'] ?? `http://127.0.0.1:${port}`;
}

/**
 * `POST /api/flywheel/resume` on the dashboard, the process that owns the
 * conversation lifecycle sweep and the stop marks. Never throws.
 */
export async function resumeFlywheelThroughRoute(
  sinceMs: number,
  dashboardOrigin = internalDashboardOrigin(),
): Promise<FlywheelResumeOutcome> {
  const internalToken = getInternalToken();
  let response: Response;
  try {
    response = await fetch(new URL('/api/flywheel/resume', dashboardOrigin), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: dashboardOrigin,
        ...(internalToken ? { [INTERNAL_TOKEN_HEADER]: internalToken } : {}),
      },
      body: JSON.stringify({ unlessStoppedSince: sinceMs }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    return { kind: 'failed', reason: `dashboard unreachable (${cause ?? (err instanceof Error ? err.message : String(err))})` };
  }
  const body = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown };
  const error = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
  if (response.ok) return { kind: 'resumed' };
  if (body.code === 'FlywheelAlreadyRunning') return { kind: 'already-running' };
  if (body.code === 'FlywheelStoppedOnPurpose' || body.code === 'FlywheelNotRunning') return { kind: 'refused', reason: error };
  return { kind: 'failed', reason: error };
}

let bootTimeCache: number | null = null;

/** The boot does not move while this process runs, so read it once. */
function defaultBootTimeMs(): number {
  bootTimeCache ??= Date.now() - Math.round(uptime() * 1000);
  return bootTimeCache;
}

const defaultDeps: FlywheelWatchdogDeps = {
  readRun: async () => (await import('../flywheel/derive-status.js')).readFlywheelRun(),
  readTranscript: defaultReadTranscript,
  paneState: defaultPaneState,
  nudge: defaultNudge,
  resume: (sinceMs) => resumeFlywheelThroughRoute(sinceMs),
  isNoResumeBoot: () => isNoResumeValueEnabled(process.env.OVERDECK_NO_RESUME),
  bootTimeMs: defaultBootTimeMs,
  log: (message, level) => emitActivityEntry({ source: 'cloister', level, message, link: '/flywheel' }),
  now: () => Date.now(),
};

// ============================================================================
// In-memory state
// ============================================================================

/** The last nudge: which tick it answered and when. */
let lastNudge: { tickAt: string; at: number } | null = null;
let resumeAttempts = 0;
let lastResumeAttemptAt: number | null = null;
/** A resume succeeded, was refused, or ran out of attempts: no more this process. */
let resumeSettled = false;

export function __resetFlywheelWatchdogStateForTests(): void {
  lastNudge = null;
  resumeAttempts = 0;
  lastResumeAttemptAt = null;
  resumeSettled = false;
  bootTimeCache = null;
}

// ============================================================================
// The routine
// ============================================================================

/**
 * Never throws: it runs first in the patrol, so a failure here must not stop
 * the routines after it.
 */
export async function watchFlywheelLoop(overrides: Partial<FlywheelWatchdogDeps> = {}): Promise<string[]> {
  const deps: FlywheelWatchdogDeps = { ...defaultDeps, ...overrides };
  try {
    const { conv, run } = await deps.readRun();
    if (!conv) return [];
    if (run === 'running') return await nudgeIfStalled(conv, deps);
    if (run === 'paused') return await resumeIfRebooted(conv, deps);
    return [];
  } catch (err) {
    console.error('[deacon-lite] watchFlywheelLoop failed:', err);
    return [];
  }
}

async function nudgeIfStalled(conv: LegacyConversation, deps: FlywheelWatchdogDeps): Promise<string[]> {
  const transcript = await deps.readTranscript(conv);
  if (!transcript) return [];
  const tick = findLastTick(transcript.messages);
  if (!tick || tick.phase === 'stopping') return [];
  const now = deps.now();
  const ageMs = now - Date.parse(tick.at);
  if (!(ageMs > FLYWHEEL_FRESHNESS_BREATHING_MS)) return [];
  if (!transcript.atTurnBoundary) return [];
  if (lastNudge && lastNudge.tickAt === tick.at && now - lastNudge.at < FLYWHEEL_FRESHNESS_BREATHING_MS) return [];
  if ((await deps.paneState(conv)) === 'busy') return [];

  // Stamp before delivering, so a failing delivery is not retried every minute.
  lastNudge = { tickAt: tick.at, at: now };
  const minutes = Math.floor(ageMs / 60_000);
  try {
    await deps.nudge();
  } catch (err) {
    const line = `${ROUTINE}: could not deliver ${FLYWHEEL_SKILL_COMMAND} to ${conv.tmuxSession} after tick ${tick.tick} went ${minutes} min stale — ${err instanceof Error ? err.message : String(err)}`;
    deps.log(`Flywheel watchdog: ${line}`, 'warn');
    return [line];
  }
  const line = `${ROUTINE}: sent ${FLYWHEEL_SKILL_COMMAND} to ${conv.tmuxSession} — the loop was idle and its last tick (${tick.tick}) was ${minutes} min old`;
  deps.log(`Flywheel watchdog restarted the loop: its last tick (${tick.tick}) was ${minutes} min old and the conversation was idle, so it sent ${FLYWHEEL_SKILL_COMMAND}`, 'info');
  return [line];
}

async function resumeIfRebooted(conv: LegacyConversation, deps: FlywheelWatchdogDeps): Promise<string[]> {
  if (resumeSettled || deps.isNoResumeBoot()) return [];
  if (conv.forkStatus) return [];
  const bootMs = deps.bootTimeMs();
  if (!(Date.parse(conv.createdAt) < bootMs)) return [];
  if (conv.status === 'ended' && !(Date.parse(conv.endedAt ?? '') >= bootMs)) return [];

  const transcript = await deps.readTranscript(conv);
  if (!transcript) return [];
  const newest = transcript.messages[transcript.messages.length - 1];
  if (newest && !(Date.parse(newest.createdAt) < bootMs)) return [];
  if (findLastTick(transcript.messages)?.phase === 'stopping') return [];

  const now = deps.now();
  if (lastResumeAttemptAt !== null && now - lastResumeAttemptAt < FLYWHEEL_RESUME_RETRY_MS) return [];
  resumeAttempts += 1;
  lastResumeAttemptAt = now;

  const outcome = await deps.resume(bootMs);
  switch (outcome.kind) {
    case 'resumed': {
      resumeSettled = true;
      deps.log('Flywheel watchdog resumed the loop: it was running when the host rebooted', 'info');
      return [`${ROUTINE}: resumed ${conv.tmuxSession} after the host reboot`];
    }
    case 'already-running':
      resumeSettled = true;
      return [];
    case 'refused': {
      resumeSettled = true;
      return [`${ROUTINE}: did not resume ${conv.tmuxSession} after the host reboot — ${outcome.reason}`];
    }
    case 'failed': {
      const last = resumeAttempts >= FLYWHEEL_RESUME_MAX_ATTEMPTS;
      if (last) resumeSettled = true;
      const line = `${ROUTINE}: resume of ${conv.tmuxSession} after the host reboot failed (attempt ${resumeAttempts} of ${FLYWHEEL_RESUME_MAX_ATTEMPTS}) — ${outcome.reason}`;
      deps.log(
        last
          ? `Flywheel watchdog could not resume the loop after the host reboot and stopped trying: ${outcome.reason}. Run pan flywheel resume.`
          : `Flywheel watchdog could not resume the loop after the host reboot (attempt ${resumeAttempts} of ${FLYWHEEL_RESUME_MAX_ATTEMPTS}): ${outcome.reason}`,
        'warn',
      );
      return [line];
    }
  }
}
