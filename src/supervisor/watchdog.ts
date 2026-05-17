import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { acquireRestartLock } from '../lib/restart-lock.js';
import { writeRestartStatus } from '../lib/restart-status.js';
import { getPanopticonHome } from '../lib/paths.js';

export interface SupervisorWatchdogConfig {
  enabled: boolean;
  dashboardApiPort: number;
  pollMs: number;
  failThreshold: number;
  maxRestarts: number;
  windowMs: number;
  requestTimeoutMs: number;
}

export interface SupervisorWatchdogStatus {
  healthy: boolean;
  lastCheck: string | null;
  consecutiveFailures: number;
  restartAttempts: string[];
  gaveUp: boolean;
  lastError: string | null;
}

export type SpawnRestart = () => { pid: number | null; error: string | null };
export type LogFn = (msg: string) => void;

type FetchFn = (input: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; statusText: string }>;

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
  restartAttempts: number[];
  gaveUp: boolean;
  lastError: string | null;
}

interface WatchdogPersistentState {
  restartAttempts: number[];
  gaveUp: boolean;
}

function watchdogStatePath(): string {
  return join(getPanopticonHome(), 'supervisor-watchdog.json');
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

function writeWatchdogPersistentState(state: WatchdogPersistentState): void {
  const path = watchdogStatePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readWatchdogConfig(env: NodeJS.ProcessEnv, dashboardApiPort: number): SupervisorWatchdogConfig {
  return {
    enabled: env.PANOPTICON_SUPERVISOR_WATCHDOG !== '0',
    dashboardApiPort,
    pollMs: parsePositiveIntEnv(env.PANOPTICON_SUPERVISOR_POLL_MS, 10_000),
    failThreshold: parsePositiveIntEnv(env.PANOPTICON_SUPERVISOR_FAIL_THRESHOLD, 3),
    maxRestarts: parsePositiveIntEnv(env.PANOPTICON_SUPERVISOR_MAX_RESTARTS, 3),
    windowMs: parsePositiveIntEnv(env.PANOPTICON_SUPERVISOR_WINDOW_MS, 5 * 60_000),
    requestTimeoutMs: 2_000,
  };
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
    const url = `http://127.0.0.1:${this.config.dashboardApiPort}/api/health`;
    try {
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`health check returned ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
      }
      this.state.healthy = true;
      this.state.lastCheck = checkedAt;
      this.state.consecutiveFailures = 0;
      this.state.gaveUp = false;
      this.state.lastError = null;
      this.pruneRestartAttempts(startedAt);
      this.persistState();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.healthy = false;
      this.state.lastCheck = checkedAt;
      this.state.consecutiveFailures += 1;
      this.state.lastError = message;
    }

    if (this.state.consecutiveFailures < this.config.failThreshold) return;
    this.pruneRestartAttempts(startedAt);
    this.persistState();
    if (this.state.gaveUp) return;

    if (this.state.restartAttempts.length >= this.config.maxRestarts) {
      this.state.gaveUp = true;
      this.persistState();
      const error = `WATCHDOG GIVING UP — manual intervention required: ${this.state.lastError ?? 'dashboard health check failed'}`;
      this.log(error);
      writeRestartStatus({
        ts: new Date(startedAt).toISOString(),
        trigger: 'watchdog',
        success: false,
        error,
        durationMs: this.now() - startedAt,
        attempts: this.state.restartAttempts.length,
        gaveUp: true,
      });
      return;
    }

    const lock = acquireRestartLock('supervisor watchdog');
    if (!lock) {
      this.log('watchdog restart skipped: restart lock held');
      return;
    }
    lock.release();

    this.state.restartAttempts.push(startedAt);
    this.persistState();
    this.log(`watchdog triggering dashboard restart after ${this.state.consecutiveFailures} consecutive failures`);
    const result = this.spawnRestart();
    writeRestartStatus({
      ts: new Date(startedAt).toISOString(),
      trigger: 'watchdog',
      success: result.error === null,
      error: result.error ?? undefined,
      durationMs: this.now() - startedAt,
      attempts: this.state.restartAttempts.length,
    });
    if (result.error) {
      this.log(`watchdog restart spawn failed: ${result.error}`);
    } else {
      this.log(`watchdog spawned pan restart --dashboard${result.pid ? ` (pid ${result.pid})` : ''}`);
    }
  }

  private pruneRestartAttempts(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.state.restartAttempts = this.state.restartAttempts.filter((ts) => ts >= cutoff);
  }

  private persistState(): void {
    writeWatchdogPersistentState({
      restartAttempts: this.state.restartAttempts,
      gaveUp: this.state.gaveUp,
    });
  }
}
