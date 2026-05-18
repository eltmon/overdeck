import { loadConfigAsyncNoMigration } from '../lib/config-yaml.js';
import { getTtsDaemonStatus, hasTtsDaemonState, isTtsDaemonManuallyStopped, startTtsDaemon } from '../lib/tts-daemon.js';
import { parsePositiveIntEnv } from './watchdog.js';

export interface TtsWatchdogConfig {
  enabled: boolean;
  pollMs: number;
  failThreshold: number;
  maxRestarts: number;
  windowMs: number;
  startTimeoutMs: number;
}

export interface TtsWatchdogStatus {
  enabled: boolean;
  active: boolean;
  consecutiveFailures: number;
  restartCount: number;
  gaveUp: boolean;
  lastError: string | null;
  lastRestartAt: string | null;
  nextPollAt: string | null;
}

function parseTtsWatchdogIntEnv(value: string | undefined, fallback: number, minimum: number): number {
  return Math.max(minimum, parsePositiveIntEnv(value, fallback));
}

export function readTtsWatchdogConfig(env: NodeJS.ProcessEnv = process.env): TtsWatchdogConfig {
  return {
    enabled: env.PANOPTICON_TTS_WATCHDOG !== '0',
    pollMs: parseTtsWatchdogIntEnv(env.PANOPTICON_TTS_WATCHDOG_POLL_MS, 5_000, 1_000),
    failThreshold: parseTtsWatchdogIntEnv(env.PANOPTICON_TTS_WATCHDOG_FAIL_THRESHOLD, 1, 1),
    maxRestarts: parseTtsWatchdogIntEnv(env.PANOPTICON_TTS_WATCHDOG_MAX_RESTARTS, 3, 1),
    windowMs: parseTtsWatchdogIntEnv(env.PANOPTICON_TTS_WATCHDOG_WINDOW_MS, 10 * 60_000, 1_000),
    startTimeoutMs: parseTtsWatchdogIntEnv(env.PANOPTICON_TTS_WATCHDOG_START_TIMEOUT_MS, 25_000, 1_000),
  };
}

export class TtsWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private consecutiveFailures = 0;
  private restartAttempts: number[] = [];
  private gaveUp = false;
  private active = false;
  private lastError: string | null = null;
  private lastRestartAt: string | null = null;
  private nextPollAt: string | null = null;

  constructor(private readonly options: {
    config: TtsWatchdogConfig;
    log: (msg: string) => Promise<void>;
  }) {}

  start(): void {
    if (!this.options.config.enabled || this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextPollAt = null;
  }

  status(): TtsWatchdogStatus {
    this.pruneRestarts(Date.now());
    return {
      enabled: this.options.config.enabled,
      active: this.active,
      consecutiveFailures: this.consecutiveFailures,
      restartCount: this.restartAttempts.length,
      gaveUp: this.gaveUp,
      lastError: this.lastError,
      lastRestartAt: this.lastRestartAt,
      nextPollAt: this.nextPollAt,
    };
  }

  private schedule(): void {
    if (!this.running || this.timer) return;
    this.nextPollAt = new Date(Date.now() + this.options.config.pollMs).toISOString();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick().finally(() => {
        if (this.running) this.schedule();
      });
    }, this.options.config.pollMs);
  }

  private pruneRestarts(now: number): void {
    this.restartAttempts = this.restartAttempts.filter((time) => now - time <= this.options.config.windowMs);
    if (this.restartAttempts.length < this.options.config.maxRestarts) this.gaveUp = false;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const ttsConfig = (await loadConfigAsyncNoMigration()).config.tts;
      const manuallyStopped = await isTtsDaemonManuallyStopped();
      this.active = !manuallyStopped && (ttsConfig.daemonAutoStart || await hasTtsDaemonState());
      if (!this.active) {
        this.consecutiveFailures = 0;
        this.lastError = null;
        return;
      }

      const status = await getTtsDaemonStatus(ttsConfig);
      if (status.ok || status.initializing) {
        this.consecutiveFailures = 0;
        this.lastError = status.initializing ? status.error ?? 'TTS daemon starting' : null;
        return;
      }

      this.consecutiveFailures += 1;
      this.lastError = status.error ?? 'TTS daemon unhealthy';
      if (this.consecutiveFailures < this.options.config.failThreshold) return;

      const now = Date.now();
      this.pruneRestarts(now);
      if (this.restartAttempts.length >= this.options.config.maxRestarts) {
        if (!this.gaveUp) await this.options.log(`tts watchdog giving up after ${this.restartAttempts.length} restart attempts`);
        this.gaveUp = true;
        return;
      }

      await this.options.log(`tts watchdog restarting daemon after ${this.consecutiveFailures} failures: ${this.lastError}`);
      const result = await startTtsDaemon({ config: ttsConfig, detach: true, timeoutMs: this.options.config.startTimeoutMs });
      this.restartAttempts.push(now);
      this.lastRestartAt = new Date(now).toISOString();
      if (result.ok) {
        this.consecutiveFailures = 0;
        this.lastError = null;
        await this.options.log(`tts watchdog restarted daemon pid=${result.pid ?? 'unknown'}`);
      } else {
        this.lastError = result.error ?? result.status?.error ?? 'failed to restart TTS daemon';
        await this.options.log(`tts watchdog restart failed: ${this.lastError}`);
      }
    } catch (error) {
      this.consecutiveFailures += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.options.log(`tts watchdog tick failed: ${this.lastError}`);
    } finally {
      this.ticking = false;
    }
  }
}
