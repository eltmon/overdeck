import { Effect, Layer, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  isCliproxyRunningAsync,
  isCliproxyInstalled,
  installCliproxyAsync,
  restartCliproxyAsync,
  stopCliproxyAsync,
  startCliproxyAsync,
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

const INSTALL_RETRY_COOLDOWN_MS = 5 * 60_000;

/** Start a background interval that checks CLIProxy health every 30s and
 *  auto-restarts it if it went down. */
export function startCliproxyWatchdog(): void {
  const intervalMs = 30_000;
  let lastInstallAttemptAt = 0;
  let tickInFlight = false;

  async function tick(): Promise<void> {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await refreshStatus();
      if (!lastStatus?.running) {
        const now = Date.now();
        if (!isCliproxyInstalled() && now - lastInstallAttemptAt < INSTALL_RETRY_COOLDOWN_MS) {
          return;
        }
        if (!isCliproxyInstalled()) lastInstallAttemptAt = now;
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
    } finally {
      tickInFlight = false;
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
      const request = yield* HttpServerRequest.HttpServerRequest;
      const urlOpt = HttpServerRequest.toURL(request);
      const searchParams = Option.isSome(urlOpt)
        ? urlOpt.value.searchParams
        : new URLSearchParams();
      const force = searchParams.get('force') === 'true' || searchParams.get('force') === '1';

      if (force) {
        // Force-reinstall: stop, redownload binary at the pinned version, restart.
        // Required when bumping CLIPROXY_RELEASE_VERSION — otherwise install* skips
        // because the old binary is still on disk.
        yield* Effect.promise(() => stopCliproxyAsync());
        yield* Effect.promise(() => installCliproxyAsync(true));
        yield* Effect.promise(() => startCliproxyAsync());
      } else {
        yield* Effect.promise(() => restartCliproxyAsync());
      }

      yield* Effect.promise(() => refreshStatus());
      const status = lastStatus ?? {
        running: false,
        pid: null,
        checkedAt: new Date().toISOString(),
      };
      return jsonResponse({ success: status.running, status, forced: force });
    }),
  ),
);

export const cliproxyRouteLayer = Layer.mergeAll(
  getCliproxyStatusRoute,
  postCliproxyRestartRoute,
);
