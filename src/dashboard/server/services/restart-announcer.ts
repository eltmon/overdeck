/**
 * Restart announcer — surfaces dashboard restarts in the Awareness activity feed.
 *
 * Restart writers (the supervisor watchdog, `pan reload`, `pan restart`) run in
 * separate processes and cannot reach the dashboard's in-process event store —
 * and mid-restart the dashboard is the very thing being killed. So the
 * (re)started server announces instead: it reads
 * `~/.panopticon/restart-status.json` on boot and polls it afterward, emitting
 * one activity entry per new restart-status `ts`. Polling also catches the
 * boot race (the watchdog writes the status a few seconds AFTER the new server
 * is already up) and watchdog give-ups that never restarted anything.
 *
 * The last announced `ts` is persisted in app-settings so a later boot doesn't
 * re-announce, and entries older than ANNOUNCE_MAX_AGE_MS are recorded without
 * being announced — a restart from hours ago is history, not news.
 */
import { Effect } from 'effect';
import {
  emitActivityEntrySync,
  type EmitActivityOptions,
} from '../../../lib/activity-logger.js';
import { readRestartStatus, type RestartStatus } from '../../../lib/restart-status.js';
import { getSetting, setSetting } from '../../../lib/database/app-settings.js';

export const RESTART_ANNOUNCER_LAST_TS_KEY = 'restart_announcer.last_announced_ts';
const POLL_MS = 15_000;
const ANNOUNCE_MAX_AGE_MS = 60 * 60_000;

/** Dashboard route for the restart's initiator: flywheel orchestrator → the
 *  flywheel page, conversations → their conversation page. Issue agents route
 *  via the entry's issueId instead (same destination as the issue tree). */
export function initiatorLink(initiator: string | undefined): string | undefined {
  if (!initiator) return undefined;
  if (initiator === 'conv-flywheel-orchestrator') return '/flywheel';
  if (initiator.startsWith('conv-')) return `/conv/${encodeURIComponent(initiator.slice('conv-'.length))}`;
  return undefined;
}

function describeInitiator(initiator: string | undefined): string {
  if (!initiator) return '';
  if (initiator === 'conv-flywheel-orchestrator') return ' by the flywheel orchestrator';
  if (initiator.startsWith('conv-')) return ` by conversation ${initiator.slice('conv-'.length)}`;
  return ` by ${initiator}`;
}

/** Map a restart-status entry to an activity-feed entry. Pure; exported for tests. */
export function describeRestart(status: RestartStatus): EmitActivityOptions {
  const seconds = (status.durationMs / 1000).toFixed(1);
  if (status.trigger === 'watchdog') {
    if (status.gaveUp) {
      return {
        source: 'supervisor',
        level: 'error',
        message: `Supervisor watchdog GAVE UP restarting the dashboard after ${status.attempts} attempt(s) — manual intervention required`,
        details: status.error,
      };
    }
    if (!status.success) {
      return {
        source: 'supervisor',
        level: 'error',
        message: `Supervisor watchdog dashboard restart failed (attempt ${status.attempts})${status.reason ? ` — ${status.reason}` : ''}`,
        details: status.error,
      };
    }
    return {
      source: 'supervisor',
      level: 'warn',
      message: `Supervisor watchdog restarted the dashboard (attempt ${status.attempts}, ${seconds}s)${status.reason ? ` — ${status.reason}` : ''}`,
    };
  }
  const actor = describeInitiator(status.initiator);
  return {
    source: 'dashboard',
    level: status.success ? 'info' : 'error',
    message: status.success
      ? `Dashboard restarted via ${status.trigger}${actor} (${seconds}s)`
      : `Dashboard restart via ${status.trigger}${actor} failed`,
    details: status.error,
    issueId: status.issueId,
    link: initiatorLink(status.initiator),
  };
}

export interface RestartAnnouncerDeps {
  readStatus?: () => Promise<RestartStatus | null>;
  emit?: (options: EmitActivityOptions) => void;
  getLastAnnounced?: () => string | null;
  setLastAnnounced?: (ts: string) => void;
  now?: () => number;
}

/** One announce pass. Exported for tests. Returns true if an entry was emitted. */
export async function announceNewRestart(deps: RestartAnnouncerDeps = {}): Promise<boolean> {
  const readStatus = deps.readStatus
    ?? (() => Effect.runPromise(readRestartStatus()).catch(() => null));
  const emit = deps.emit ?? emitActivityEntrySync;
  const getLastAnnounced = deps.getLastAnnounced
    ?? (() => getSetting(RESTART_ANNOUNCER_LAST_TS_KEY));
  const setLastAnnounced = deps.setLastAnnounced
    ?? ((ts: string) => setSetting(RESTART_ANNOUNCER_LAST_TS_KEY, ts));
  const now = deps.now ?? Date.now;

  const status = await readStatus();
  if (!status) return false;
  if (getLastAnnounced() === status.ts) return false;

  setLastAnnounced(status.ts);
  const ageMs = now() - Date.parse(status.ts);
  if (!Number.isFinite(ageMs) || ageMs > ANNOUNCE_MAX_AGE_MS) return false;

  emit(describeRestart(status));
  return true;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startRestartAnnouncer(deps: RestartAnnouncerDeps = {}): void {
  if (timer) return;
  const pass = () => {
    void announceNewRestart(deps).catch(() => undefined);
  };
  pass();
  timer = setInterval(pass, POLL_MS);
  timer.unref?.();
}

export function stopRestartAnnouncer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
