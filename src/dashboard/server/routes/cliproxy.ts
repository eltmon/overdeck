import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  isCliproxyRunningAsync,
  restartCliproxyAsync,
  readPidFile,
} from '../../../lib/cliproxy.js';

// ─── In-memory status cache (dashboard-server singleton) ──────────────────────

export interface CliproxyStatus {
  running: boolean;
  pid: number | null;
  checkedAt: string;
}

let lastStatus: CliproxyStatus | null = null;

export function getCachedCliproxyStatus(): CliproxyStatus | null {
  return lastStatus;
}

async function refreshStatus(): Promise<void> {
  const running = await isCliproxyRunningAsync();
  const pid = readPidFile();
  lastStatus = { running, pid, checkedAt: new Date().toISOString() };
}

// ─── Watchdog ─────────────────────────────────────────────────────────────────

/** Start a background interval that checks CLIProxy health every 30s and
 *  auto-restarts it if it went down. */
export function startCliproxyWatchdog(): void {
  const intervalMs = 30_000;

  async function tick(): Promise<void> {
    try {
      await refreshStatus();
      if (!lastStatus?.running) {
        console.log('[cliproxy-watchdog] CLIProxy is down, attempting auto-restart...');
        await restartCliproxyAsync();
        await refreshStatus();
        if (lastStatus?.running) {
          console.log('[cliproxy-watchdog] CLIProxy auto-restarted successfully');
        } else {
          console.error('[cliproxy-watchdog] CLIProxy auto-restart failed');
        }
      }
    } catch (err) {
      console.error('[cliproxy-watchdog] Error during health check:', err);
    }
  }

  // Fire initial check immediately (non-blocking)
  void tick();
  setInterval(() => void tick(), intervalMs);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const getCliproxyStatusRoute = HttpRouter.add(
  'GET',
  '/api/cliproxy/status',
  httpHandler(
    Effect.gen(function* () {
      yield* Effect.promise(() => refreshStatus());
      const status = lastStatus ?? {
        running: false,
        pid: null,
        checkedAt: new Date().toISOString(),
      };
      return jsonResponse(status);
    }),
  ),
);

const postCliproxyRestartRoute = HttpRouter.add(
  'POST',
  '/api/cliproxy/restart',
  httpHandler(
    Effect.gen(function* () {
      yield* Effect.promise(() => restartCliproxyAsync());
      yield* Effect.promise(() => refreshStatus());
      const status = lastStatus ?? {
        running: false,
        pid: null,
        checkedAt: new Date().toISOString(),
      };
      return jsonResponse({ success: status.running, status });
    }),
  ),
);

export const cliproxyRouteLayer = Layer.mergeAll(
  getCliproxyStatusRoute,
  postCliproxyRestartRoute,
);
