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

export function readPlatformConfig(): PlatformConfig {
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
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Gracefully stop the dashboard: SIGTERM, wait for the port to free, escalate to
 * SIGKILL only if the process refuses to exit in time.
 *
 * NOTE: This touches ONLY the dashboard ports. It never touches CLIProxy,
 * Traefik, or the TLDR daemon — that scope separation is the whole point.
 */
export async function stopDashboard(
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
}

/**
 * Poll `GET /api/health` on the dashboard API port until it returns 200
 * (or until timeout). Returns true on success, throws StageError on timeout.
 */
export async function waitForDashboardHealth(
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
}

// ─── Traefik ──────────────────────────────────────────────────────────────────

export async function isTraefikContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'docker ps --filter "name=panopticon-traefik" --format "{{.Names}}" 2>/dev/null',
    );
    return stdout.trim().includes('panopticon-traefik');
  } catch {
    return false;
  }
}

export async function startTraefik(config: PlatformConfig): Promise<void> {
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
}

export async function stopTraefik(config: PlatformConfig): Promise<void> {
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
}

/**
 * Restart only the dashboard. MUST NOT touch CLIProxy, Traefik, or TLDR.
 *
 * `startDashboardFn` is a caller-provided start hook (the CLI owns the concrete
 * spawn — path resolution, env, detached vs. foreground, etc.). This keeps the
 * lifecycle module free of CLI-specific concerns and makes the orchestrator
 * easy to test with a mock start hook.
 */
export async function restartDashboard(
  config: PlatformConfig,
  startDashboardFn: () => Promise<void> | void,
  opts: { healthTimeoutMs?: number } = {},
): Promise<void> {
  await stopDashboard(config);
  await startDashboardFn();
  await waitForDashboardHealth(config.dashboardApiPort, {
    timeoutMs: opts.healthTimeoutMs,
  });
}

/**
 * Restart only CLIProxy. MUST NOT touch the dashboard or Traefik.
 *
 * Takes the cliproxy module as an argument so tests can substitute mocks
 * without touching real files/binaries.
 *
 * `opts.force` triggers a binary reinstall before starting — required after
 * bumping CLIPROXY_RELEASE_VERSION because installCliproxy() skips download
 * when a binary already exists on disk.
 */
export async function restartCliproxy(
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
}

/**
 * Restart only Traefik. MUST NOT touch the dashboard or CLIProxy.
 */
export async function restartTraefik(config: PlatformConfig): Promise<void> {
  if (!config.traefikEnabled) {
    throw new StageError({
      stage: 'traefik',
      reason: 'Traefik is not enabled in config.toml',
    });
  }
  await stopTraefik(config);
  await startTraefik(config);
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
