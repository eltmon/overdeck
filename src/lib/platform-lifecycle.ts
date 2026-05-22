/**
 * Panopticon platform stack lifecycle — dashboard + CLIProxy + Traefik + TLDR.
 *
 * Used by `pan up`, `pan down`, and `pan restart`. Provides scoped primitives so
 * a dashboard restart does not strand the system or tear down unrelated shared
 * sidecars.
 *
 * Scope rules (must be preserved — see tests):
 *   - `restartDashboard()`      MUST NOT stop CLIProxy, Traefik, or TLDR.
 *   - `restartCliproxy()`       MUST NOT stop the dashboard or Traefik.
 *   - `restartTraefik()`        MUST NOT stop the dashboard or CLIProxy.
 *   - `stopFullStack()`         Stops everything (the nuclear option, used by `pan down`).
 *
 * Health-gating: each stage reports success only after the component's healthcheck
 * passes, or fails with an explicit `{ stage, reason }` on timeout.
 *
 * CLI-side only. Not used from dashboard server code — ok to use sync I/O here.
 */

import { spawn, exec, execSync } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, openSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseToml } from '@iarna/toml';
import { Effect } from 'effect';
import { LOGS_DIR, PANOPTICON_HOME, TRAEFIK_DIR, CONFIG_FILE } from './paths.js';

const execAsync = promisify(exec);

export const DASHBOARD_LOG_FILE = join(LOGS_DIR, 'dashboard.log');

/**
 * Build the stdio tuple for a detached dashboard spawn. Writes stdout+stderr
 * to `~/.panopticon/logs/dashboard.log` (append) so `pan up --detach` failures
 * leave a paper trail instead of vanishing into /dev/null. Falls back to
 * 'ignore' if the log file cannot be opened.
 */
export function openDashboardLogStdio(): ['ignore', number | 'ignore', number | 'ignore'] {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    const fd = openSync(DASHBOARD_LOG_FILE, 'a');
    return ['ignore', fd, fd];
  } catch {
    return ['ignore', 'ignore', 'ignore'];
  }
}

export interface PlatformConfig {
  dashboardPort: number;
  dashboardApiPort: number;
  traefikEnabled: boolean;
  traefikDomain: string;
  traefikDir: string;
}

export interface StageFailure {
  stage: 'traefik' | 'cliproxy' | 'dashboard' | 'tldr';
  reason: string;
}

export class StageError extends Error {
  constructor(public readonly failure: StageFailure) {
    super(`[${failure.stage}] ${failure.reason}`);
    this.name = 'StageError';
  }
}

export function readPlatformConfigSync(): PlatformConfig {
  const defaults: PlatformConfig = {
    dashboardPort: 3010,
    dashboardApiPort: 3011,
    traefikEnabled: false,
    traefikDomain: 'pan.localhost',
    traefikDir: TRAEFIK_DIR,
  };
  if (!existsSync(CONFIG_FILE)) return defaults;
  try {
    const config = parseToml(readFileSync(CONFIG_FILE, 'utf-8')) as any;
    return {
      dashboardPort: config.dashboard?.port || defaults.dashboardPort,
      dashboardApiPort: config.dashboard?.api_port || defaults.dashboardApiPort,
      traefikEnabled: config.traefik?.enabled === true,
      traefikDomain: config.traefik?.domain || defaults.traefikDomain,
      traefikDir: join(PANOPTICON_HOME, 'traefik'),
    };
  } catch {
    return defaults;
  }
}

// ─── Port / process helpers ───────────────────────────────────────────────────

async function pidsOnPort(port: number): Promise<number[]> {
  try {
    const { stdout } = await execAsync(`fuser ${port}/tcp 2>/dev/null || true`);
    return stdout
      .split(/\s+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function killPidsSync(pids: number[], signal: NodeJS.Signals | number): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // already dead
    }
  }
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await pidsOnPort(port);
    if (pids.length === 0) return true;
    await sleep(100);
  }
  return false;
}

async function describePid(pid: number): Promise<string> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o pid=,cmd=`);
    return stdout.trim().replace(/\s+/g, ' ') || 'unknown';
  } catch {
    return 'unknown';
  }
}async function stopDashboardPromise(
  config: PlatformConfig,
  opts: { graceTimeoutMs?: number } = {},
): Promise<void> {
  const graceMs = opts.graceTimeoutMs ?? 5000;
  const ports = [config.dashboardPort, config.dashboardApiPort];

  // 1. Collect pids across both ports, then SIGTERM.
  const allPids = new Set<number>();
  for (const p of ports) {
    for (const pid of await pidsOnPort(p)) allPids.add(pid);
  }
  if (allPids.size === 0) return;

  killPidsSync([...allPids], 'SIGTERM');

  // 2. Wait for ports to free. If any remain, escalate to SIGKILL.
  const freed = await Promise.all(ports.map((p) => waitForPortFree(p, graceMs)));
  if (freed.every(Boolean)) return;

  const stubbornPids = new Set<number>();
  for (const p of ports) {
    for (const pid of await pidsOnPort(p)) stubbornPids.add(pid);
  }
  if (stubbornPids.size > 0) {
    killPidsSync([...stubbornPids], 'SIGKILL');
    const finalFreed = await Promise.all(ports.map((p) => waitForPortFree(p, 2000)));
    if (finalFreed.every(Boolean)) return;

    const stillHeld: string[] = [];
    for (const [index, port] of ports.entries()) {
      if (finalFreed[index]) continue;
      for (const pid of await pidsOnPort(port)) {
        stillHeld.push(`port ${port} still held by PID ${pid} (cmd: ${await describePid(pid)})`);
      }
    }
    if (stillHeld.length > 0) {
      throw new StageError({
        stage: 'dashboard',
        reason: stillHeld.join('; '),
      });
    }
  }
}async function waitForDashboardHealthPromise(
  apiPort: number,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const url = `http://127.0.0.1:${apiPort}/api/health`;
  const deadline = Date.now() + timeoutMs;

  let lastError = 'never got a response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
    await sleep(pollIntervalMs);
  }
  throw new StageError({
    stage: 'dashboard',
    reason: `health check at ${url} did not pass within ${timeoutMs}ms (last: ${lastError})`,
  });
}async function isTraefikContainerRunningPromise(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'docker ps --filter "name=panopticon-traefik" --format "{{.Names}}" 2>/dev/null',
    );
    return stdout.trim().includes('panopticon-traefik');
  } catch {
    return false;
  }
}async function startTraefikPromise(config: PlatformConfig): Promise<void> {
  if (!config.traefikEnabled) return;
  if (!existsSync(config.traefikDir)) {
    throw new StageError({
      stage: 'traefik',
      reason: `Traefik directory missing: ${config.traefikDir}. Run \`pan install\`.`,
    });
  }
  try {
    await execAsync('docker compose up -d', { cwd: config.traefikDir });
  } catch (err: any) {
    throw new StageError({
      stage: 'traefik',
      reason: `docker compose up failed: ${err?.stderr || err?.message || String(err)}`,
    });
  }
}async function stopTraefikPromise(config: PlatformConfig): Promise<void> {
  if (!existsSync(config.traefikDir)) return;
  try {
    await execAsync('docker compose down', { cwd: config.traefikDir });
  } catch {
    // non-fatal: traefik may already be down
  }
}

// ─── Scoped restart orchestrators ─────────────────────────────────────────────

export interface RestartResult {
  stage: 'traefik' | 'cliproxy' | 'dashboard' | 'full';
  success: boolean;
  failure?: StageFailure;
}async function restartDashboardPromise(
  config: PlatformConfig,
  startDashboardFn: () => Promise<void> | void,
  opts: { healthTimeoutMs?: number } = {},
): Promise<void> {
  await Effect.runPromise(stopDashboard(config));
  await startDashboardFn();
  await Effect.runPromise(waitForDashboardHealth(config.dashboardApiPort, {
    timeoutMs: opts.healthTimeoutMs,
  }));
}async function restartCliproxyPromise(
  cliproxy: {
    stopCliproxy: () => void;
    startCliproxy: () => void;
    isCliproxyRunning: () => boolean;
    installCliproxy?: (force?: boolean) => void;
  },
  opts: { verifyTimeoutMs?: number; force?: boolean } = {},
): Promise<void> {
  cliproxy.stopCliproxy();
  // Small wait so the port releases before we re-bind.
  await sleep(200);

  if (opts.force) {
    if (!cliproxy.installCliproxy) {
      throw new StageError({
        stage: 'cliproxy',
        reason: 'force=true was requested but cliproxy module does not export installCliproxy',
      });
    }
    cliproxy.installCliproxy(true);
  }

  cliproxy.startCliproxy();

  const timeoutMs = opts.verifyTimeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cliproxy.isCliproxyRunning()) return;
    await sleep(100);
  }
  throw new StageError({
    stage: 'cliproxy',
    reason: `CLIProxy did not come back up within ${timeoutMs}ms — check ${join(PANOPTICON_HOME, 'cliproxy', 'cliproxy.log')}`,
  });
}async function restartTraefikPromise(config: PlatformConfig): Promise<void> {
  if (!config.traefikEnabled) {
    throw new StageError({
      stage: 'traefik',
      reason: 'Traefik is not enabled in config.toml',
    });
  }
  await Effect.runPromise(stopTraefik(config));
  await Effect.runPromise(startTraefik(config));
}

/**
 * Best-effort: leave the system in a recoverable state if a staged start fails.
 *
 * Specifically — if the dashboard fails to start but CLIProxy was already
 * running before we touched anything, DO NOT stop CLIProxy on our way out.
 * This is the explicit recovery contract from the task brief.
 */
export function describeStageFailure(err: unknown): StageFailure | null {
  if (err instanceof StageError) return err.failure;
  return null;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const stageErrorOf = (op: string) => (cause: unknown): StageError => {
  if (cause instanceof StageError) return cause;
  return new StageError({
    stage: 'dashboard',
    reason: `${op} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  });
};

/** Effect variant of {@link stopDashboard}. */
export const stopDashboard = (
  config: PlatformConfig,
  opts: { graceTimeoutMs?: number } = {},
): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => stopDashboardPromise(config, opts), catch: stageErrorOf('stopDashboard') });

/** Effect variant of {@link waitForDashboardHealth}. */
export const waitForDashboardHealth = (
  apiPort: number,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => waitForDashboardHealthPromise(apiPort, opts), catch: stageErrorOf('waitForDashboardHealth') });

/** Effect variant of {@link isTraefikContainerRunning}. */
export const isTraefikContainerRunning = (): Effect.Effect<boolean, never> =>
  Effect.promise(() => isTraefikContainerRunningPromise());

/** Effect variant of {@link startTraefik}. */
export const startTraefik = (config: PlatformConfig): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => startTraefikPromise(config), catch: stageErrorOf('startTraefik') });

/** Effect variant of {@link stopTraefik}. */
export const stopTraefik = (config: PlatformConfig): Effect.Effect<void, never> =>
  Effect.promise(() => stopTraefikPromise(config));

/** Effect variant of {@link restartDashboard}. */
export const restartDashboard = (
  config: PlatformConfig,
  startDashboardFn: () => Promise<void> | void,
  opts: { healthTimeoutMs?: number } = {},
): Effect.Effect<void, StageError> =>
  Effect.tryPromise({
    try: () => restartDashboardPromise(config, startDashboardFn, opts),
    catch: stageErrorOf('restartDashboard'),
  });

/** Effect variant of {@link restartCliproxy}. */
export const restartCliproxy = (
  cliproxy: {
    stopCliproxy: () => void;
    startCliproxy: () => void;
    isCliproxyRunning: () => boolean;
    installCliproxy?: (force?: boolean) => void;
  },
  opts: { verifyTimeoutMs?: number; force?: boolean } = {},
): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => restartCliproxyPromise(cliproxy, opts), catch: stageErrorOf('restartCliproxy') });

/** Effect variant of {@link restartTraefik}. */
export const restartTraefik = (config: PlatformConfig): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => restartTraefikPromise(config), catch: stageErrorOf('restartTraefik') });

/** Effect variant of {@link readPlatformConfigSync}. Pure config read; cannot fail. */
export const readPlatformConfig = (): Effect.Effect<PlatformConfig, never> =>
  Effect.sync(() => readPlatformConfigSync());
