import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { acquireRestartLock } from '../lib/restart-lock.js';
import { writeRestartStatus } from '../lib/restart-status.js';
import { getOverdeckHome } from '../lib/paths.js';
import { getBootReconciliationState } from '../lib/overdeck/control-settings.js';

export interface SupervisorWatchdogConfig {
  enabled: boolean;
  dashboardApiPort: number;
  pollMs: number;
  failThreshold: number;
  /** Restart threshold for timeout-only failure streaks. A timeout means the
   *  server accepted the probe but couldn't answer in time — busy/starved, not
   *  dead. Restarting a busy server kills in-flight pipeline work (verification
   *  gates, review convoys), so these streaks get a much longer leash than
   *  hard failures (connection refused / non-OK status). */
  busyFailThreshold: number;
  maxRestarts: number;
  windowMs: number;
  requestTimeoutMs: number;
}

export interface SupervisorWatchdogStatus {
  healthy: boolean;
  lastCheck: string | null;
  consecutiveFailures: number;
  consecutiveHardFailures: number;
  restartAttempts: string[];
  gaveUp: boolean;
  lastError: string | null;
}

export type SpawnRestartResult = { pid: number | null; error: string | null; done?: Promise<void> };
export type SpawnRestart = (options?: {
  restartLockHeld?: boolean;
  bootId?: string | null;
}) => SpawnRestartResult | Promise<SpawnRestartResult>;
export type LogFn = (msg: string) => void | Promise<void>;

type FetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json?: () => Promise<unknown>;
};
type FetchFn = (input: string, init: { signal: AbortSignal }) => Promise<FetchResponse>;

interface SupervisorWatchdogDeps {
  config: SupervisorWatchdogConfig;
  spawnRestart: SpawnRestart;
  log: LogFn;
  fetchFn?: FetchFn;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

interface InternalState {
  healthy: boolean;
  lastCheck: string | null;
  consecutiveFailures: number;
  consecutiveHardFailures: number;
  patrolUnhealthySince: number | null;
  restartAttempts: number[];
  gaveUp: boolean;
  lastError: string | null;
}

interface WatchdogPersistentState {
  restartAttempts: number[];
  gaveUp: boolean;
}

function watchdogStatePath(): string {
  return join(getOverdeckHome(), 'supervisor-watchdog.json');
}

function readWatchdogPersistentState(): WatchdogPersistentState {
  try {
    const parsed = JSON.parse(readFileSync(watchdogStatePath(), 'utf8')) as Partial<WatchdogPersistentState>;
    const restartAttempts = Array.isArray(parsed.restartAttempts)
      ? parsed.restartAttempts.filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts))
      : [];
    return {
      restartAttempts,
      gaveUp: parsed.gaveUp === true,
    };
  } catch {
    return { restartAttempts: [], gaveUp: false };
  }
}

async function writeWatchdogPersistentState(state: WatchdogPersistentState): Promise<void> {
  const path = watchdogStatePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readWatchdogConfig(env: NodeJS.ProcessEnv, dashboardApiPort: number): SupervisorWatchdogConfig {
  return {
    enabled: env.OVERDECK_SUPERVISOR_WATCHDOG !== '0',
    dashboardApiPort,
    pollMs: parsePositiveIntEnv(env.OVERDECK_SUPERVISOR_POLL_MS, 10_000),
    failThreshold: parsePositiveIntEnv(env.OVERDECK_SUPERVISOR_FAIL_THRESHOLD, 3),
    busyFailThreshold: parsePositiveIntEnv(env.OVERDECK_SUPERVISOR_BUSY_FAIL_THRESHOLD, 12),
    maxRestarts: parsePositiveIntEnv(env.OVERDECK_SUPERVISOR_MAX_RESTARTS, 3),
    windowMs: parsePositiveIntEnv(env.OVERDECK_SUPERVISOR_WINDOW_MS, 5 * 60_000),
    requestTimeoutMs: parsePositiveIntEnv(env.OVERDECK_SUPERVISOR_TIMEOUT_MS, 10_000),
  };
}

export function readBootReconciliationBootIdForRestart(): string | null {
  try {
    return getBootReconciliationState().bootId ?? process.env.OVERDECK_BOOT_ID ?? null;
  } catch {
    return process.env.OVERDECK_BOOT_ID ?? null;
  }
}

/** AbortSignal.timeout() rejects fetch with a TimeoutError (AbortError on older
 *  runtimes). Anything else — ECONNREFUSED, reset, non-OK status — means the
 *  server is genuinely down or broken, not merely starved for CPU. */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export class SupervisorWatchdog {
  private readonly config: SupervisorWatchdogConfig;
  private readonly spawnRestart: SpawnRestart;
  private readonly log: LogFn;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningCheck: Promise<void> | null = null;
  private readonly state: InternalState;

  constructor(deps: SupervisorWatchdogDeps) {
    const persistedState = readWatchdogPersistentState();
    this.config = deps.config;
    this.spawnRestart = deps.spawnRestart;
    this.log = deps.log;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
    this.state = {
      healthy: true,
      lastCheck: null,
      consecutiveFailures: 0,
      consecutiveHardFailures: 0,
      patrolUnhealthySince: null,
      restartAttempts: persistedState.restartAttempts,
      gaveUp: persistedState.gaveUp,
      lastError: null,
    };
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = this.setIntervalFn(() => {
      void this.checkOnce();
    }, this.config.pollMs);
  }

  stop(): void {
    if (!this.timer) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  status(): SupervisorWatchdogStatus {
    return {
      healthy: this.state.healthy,
      lastCheck: this.state.lastCheck,
      consecutiveFailures: this.state.consecutiveFailures,
      consecutiveHardFailures: this.state.consecutiveHardFailures,
      restartAttempts: this.state.restartAttempts.map((ts) => new Date(ts).toISOString()),
      gaveUp: this.state.gaveUp,
      lastError: this.state.lastError,
    };
  }

  async checkOnce(): Promise<void> {
    if (this.runningCheck) return this.runningCheck;
    this.runningCheck = this.runCheck().finally(() => {
      this.runningCheck = null;
    });
    return this.runningCheck;
  }

  private async runCheck(): Promise<void> {
    const startedAt = this.now();
    const checkedAt = new Date(startedAt).toISOString();
    const dashboardBaseUrl = `http://127.0.0.1:${this.config.dashboardApiPort}`;
    const url = `${dashboardBaseUrl}/api/health`;
    let restartReason: string | null = null;
    let restartLogReason: string | null = null;
    try {
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`health check returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
      }

      const patrolFailure = await this.assessDeaconPatrol(dashboardBaseUrl, startedAt);
      if (patrolFailure) {
        this.state.healthy = false;
        this.state.lastCheck = checkedAt;
        this.state.consecutiveFailures += 1;
        this.state.consecutiveHardFailures = 0;
        this.state.lastError = patrolFailure.message;
        if (!patrolFailure.restartReady) return;
        restartReason = patrolFailure.reason;
        restartLogReason = patrolFailure.logReason;
      } else {
        this.state.patrolUnhealthySince = null;
      }

      if (!restartReason) {
        const shouldPersistClear = this.state.restartAttempts.length > 0 || this.state.gaveUp;
        this.state.healthy = true;
        this.state.lastCheck = checkedAt;
        this.state.consecutiveFailures = 0;
        this.state.consecutiveHardFailures = 0;
        this.state.restartAttempts = [];
        this.state.gaveUp = false;
        this.state.lastError = null;
        if (shouldPersistClear) {
          await this.persistState();
        }
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.healthy = false;
      this.state.lastCheck = checkedAt;
      this.state.consecutiveFailures += 1;
      this.state.consecutiveHardFailures = isTimeoutError(error) ? 0 : this.state.consecutiveHardFailures + 1;
      this.state.lastError = message;

      // Dead vs busy: hard failures (refused/reset/non-OK) restart at
      // failThreshold; timeout-only streaks wait for busyFailThreshold so a
      // server starved by verification gates isn't killed mid-pipeline.
      const hardDown = this.state.consecutiveHardFailures >= this.config.failThreshold;
      const busyStarved = this.state.consecutiveFailures >= this.config.busyFailThreshold;
      if (!hardDown && !busyStarved) {
        if (this.state.consecutiveFailures === this.config.failThreshold) {
          await this.log(
            `watchdog: dashboard slow but alive (${this.state.lastError ?? 'timeout'}) — `
            + `${this.state.consecutiveFailures} consecutive timeouts; deferring restart until ${this.config.busyFailThreshold}`,
          );
        }
        return;
      }
      restartReason = hardDown
        ? `dashboard unreachable: ${this.state.lastError ?? 'health check failed'}`
        : `sustained health-probe timeouts: ${this.state.lastError ?? 'health check timed out'}`;
      restartLogReason = hardDown ? 'dashboard unreachable' : 'sustained timeouts — dashboard starved';
    }

    this.pruneRestartAttempts(startedAt);
    await this.persistState();
    if (this.state.gaveUp) return;

    if (this.state.restartAttempts.length >= this.config.maxRestarts) {
      this.state.gaveUp = true;
      await this.persistState();
      const error = `WATCHDOG GIVING UP — manual intervention required: ${this.state.lastError ?? 'dashboard health check failed'}`;
      await this.log(error);
      await Effect.runPromise(writeRestartStatus({
        ts: new Date(startedAt).toISOString(),
        trigger: 'watchdog',
        success: false,
        error,
        durationMs: this.now() - startedAt,
        attempts: this.state.restartAttempts.length,
        gaveUp: true,
        reason: restartReason ?? restartLogReason ?? 'dashboard health check failed',
        pid: process.pid,
      }));
      return;
    }

    const lock = await Effect.runPromise(acquireRestartLock('supervisor watchdog'));
    if (!lock) {
      await this.log('watchdog restart skipped: restart lock held');
      return;
    }

    this.state.restartAttempts.push(startedAt);
    await this.persistState();
    await this.log(
      `watchdog triggering dashboard restart after ${this.state.consecutiveFailures} consecutive failures `
      + `(${restartLogReason ?? 'dashboard health check failed'})`,
    );

    let restartError: string | null = null;
    try {
      const result = await this.spawnRestart({
        restartLockHeld: true,
        bootId: readBootReconciliationBootIdForRestart(),
      });
      if (result.error) {
        restartError = result.error;
      } else {
        await this.log(`watchdog spawned pan restart --dashboard${result.pid ? ` (pid ${result.pid})` : ''}`);
        if (result.done) {
          await result.done;
        }
      }
    } catch (error) {
      restartError = error instanceof Error ? error.message : String(error);
    } finally {
      await lock.release();
    }

    // PAN-2219: a restart gives the new server a fresh patrol-grace window.
    // Without this the pre-restart staleness clock carried over, so each new
    // boot was killed before boot reconciliation + its first patrol could
    // complete — restart churn until maxRestarts/gaveUp.
    this.state.patrolUnhealthySince = null;

    await Effect.runPromise(writeRestartStatus({
      ts: new Date(startedAt).toISOString(),
      trigger: 'watchdog',
      success: restartError === null,
      error: restartError ?? undefined,
      durationMs: this.now() - startedAt,
      attempts: this.state.restartAttempts.length,
      reason: restartReason ?? 'dashboard health check failed',
      pid: process.pid,
    }));
    if (restartError) {
      await this.log(`watchdog restart failed: ${restartError}`);
    }
  }

  private pruneRestartAttempts(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.state.restartAttempts = this.state.restartAttempts.filter((ts) => ts >= cutoff);
  }

  private async assessDeaconPatrol(
    dashboardBaseUrl: string,
    nowMs: number,
  ): Promise<{ message: string; restartReady: boolean; reason: string; logReason: string } | null> {
    const response = await this.fetchFn(`${dashboardBaseUrl}/api/deacon/status`, {
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`deacon status check returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }
    if (!response.json) {
      throw new Error('deacon status check returned no JSON body');
    }

    const status = await response.json();
    const record = status && typeof status === 'object' ? status as Record<string, unknown> : {};
    const isRunning = record.isRunning === true;
    if (!isRunning) {
      this.state.patrolUnhealthySince = null;
      return null;
    }

    const config = record.config && typeof record.config === 'object' ? record.config as Record<string, unknown> : {};
    const state = record.state && typeof record.state === 'object' ? record.state as Record<string, unknown> : {};
    const interval = typeof config.patrolIntervalMs === 'number' && Number.isFinite(config.patrolIntervalMs) && config.patrolIntervalMs > 0
      ? config.patrolIntervalMs
      : 60_000;
    const staleAfterMs = interval * 3;
    const lastPatrol = typeof state.lastPatrol === 'string' ? state.lastPatrol : null;

    if (!lastPatrol) {
      this.state.patrolUnhealthySince ??= nowMs;
      const unhealthyForMs = nowMs - this.state.patrolUnhealthySince;
      return {
        message: `deacon patrol heartbeat missing for ${Math.floor(unhealthyForMs / 1000)}s`,
        restartReady: unhealthyForMs > staleAfterMs,
        reason: `deacon patrol heartbeat missing for >${Math.ceil(staleAfterMs / 1000)}s`,
        logReason: 'deacon patrol heartbeat missing',
      };
    }

    const lastPatrolMs = Date.parse(lastPatrol);
    if (!Number.isFinite(lastPatrolMs)) {
      return {
        message: `deacon patrol heartbeat invalid: ${lastPatrol}`,
        restartReady: true,
        reason: `deacon patrol heartbeat invalid: ${lastPatrol}`,
        logReason: 'deacon patrol heartbeat invalid',
      };
    }

    const ageMs = Math.max(0, nowMs - lastPatrolMs);
    if (ageMs <= staleAfterMs) return null;
    return {
      message: `deacon patrol heartbeat stale for ${Math.floor(ageMs / 1000)}s`,
      restartReady: true,
      reason: `deacon patrol heartbeat stale for ${Math.floor(ageMs / 1000)}s (threshold ${Math.ceil(staleAfterMs / 1000)}s)`,
      logReason: 'deacon patrol heartbeat stale',
    };
  }

  private async persistState(): Promise<void> {
    await writeWatchdogPersistentState({
      restartAttempts: this.state.restartAttempts,
      gaveUp: this.state.gaveUp,
    });
  }
}
