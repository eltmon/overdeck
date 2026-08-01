/**
 * Overdeck platform stack lifecycle — dashboard + CLIProxy + Traefik + TLDR.
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
 * Shared with the supervisor sidecar. Keep shell/process I/O asynchronous so
 * lifecycle checks cannot block its request loop.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, openSync, readFileSync } from 'fs';
import { open as openFile, stat } from 'fs/promises';
import { join } from 'path';
import { parse as parseToml } from '@iarna/toml';
import { Effect } from 'effect';
import { LOGS_DIR, OVERDECK_HOME, TRAEFIK_DIR, CONFIG_FILE } from './paths.js';
import { readDevSupervisorMarker } from './dev-supervisor.js';

const execAsync = promisify(exec);

/**
 * Minimum health-wait budget: a dashboard cold boot cannot bind + answer
 * /api/health faster than this, so anything below it is a guaranteed false
 * failure — and a false failure here used to reap the healthy new server,
 * leaving ZERO listeners (#3099, 2026-07-26 dashboard-down incident caused by
 * `--health-timeout 120` being read as 120ms).
 */
export const MIN_HEALTH_TIMEOUT_MS = 1000;

/**
 * Parse the operator-facing `--health-timeout` flag. Bare numbers are
 * milliseconds (back-compat) but floored at MIN_HEALTH_TIMEOUT_MS; `s`/`m`
 * suffixes give seconds/minutes (`120s`, `2m`). Throws on garbage, NaN, and
 * sub-floor values with the unit spelled out — the incident above came from
 * the operator reasonably assuming seconds.
 */
export function parseHealthTimeoutMs(value: string | undefined, defaultMs: number): number {
  if (value === undefined || value === '') return defaultMs;
  const m = value.trim().match(/^(\d+)(ms|s|m)?$/i);
  if (!m) {
    throw new Error(
      `--health-timeout must be a positive integer with an optional unit suffix ` +
      `(e.g. "30000", "30s", "2m"), got "${value}"`,
    );
  }
  const n = Number.parseInt(m[1], 10);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60_000;
  if (ms < MIN_HEALTH_TIMEOUT_MS) {
    const hint = m[2] ? '' : ` — did you mean ${n}s?`;
    throw new Error(
      `--health-timeout of ${ms}ms is below the ${MIN_HEALTH_TIMEOUT_MS}ms floor; ` +
      `a dashboard cold boot cannot health-check that fast${hint}`,
    );
  }
  return ms;
}

/** Human-readable timeout for health-gate messages (`120s` / `500ms`). */
function formatTimeoutMs(timeoutMs: number): string {
  if (timeoutMs >= 1000 && timeoutMs % 1000 === 0) return `${timeoutMs / 1000}s`;
  return `${timeoutMs}ms`;
}

export const DASHBOARD_LOG_FILE = join(LOGS_DIR, 'dashboard.log');

/**
 * Build the stdio tuple for a detached dashboard spawn. Writes stdout+stderr
 * to `~/.overdeck/logs/dashboard.log` (append) so `pan up --detach` failures
 * leave a paper trail instead of vanishing into /dev/null. Falls back to
 * 'ignore' if the log file cannot be opened.
 */
export function openDashboardLogStdio(): ['ignore', number | 'ignore', number | 'ignore'] {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    const fd = openSync(DASHBOARD_LOG_FILE, 'a');
    return ['ignore', fd, fd];
  } catch (err) {
    // Don't silently discard the dashboard's output (PAN-1552). Surface why the
    // log file could not be opened so a detached `pan up` failure isn't invisible.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[pan up] could not open ${DASHBOARD_LOG_FILE} for logging: ${msg} — dashboard output will not be captured\n`,
    );
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
  recovery?: 'dashboard-left-running';
}

export class StageError extends Error {
  constructor(public readonly failure: StageFailure) {
    super(`[${failure.stage}] ${failure.reason}`);
    this.name = 'StageError';
  }
}

class EaddrinuseSpawnError extends StageError {}
class DashboardPortsReleasedError extends StageError {}

type PidSurvivorProbe = (pid: number) => Promise<string | null>;

type DashboardStopOptions = {
  graceTimeoutMs?: number;
  portOwnerProbe?: (port: number) => Promise<number[]>;
  pidSurvivorProbe?: PidSurvivorProbe;
};

export function readPlatformConfigSync(): PlatformConfig {
  const defaults: PlatformConfig = {
    dashboardPort: 3010,
    dashboardApiPort: 3011,
    traefikEnabled: false,
    traefikDomain: 'overdeck.localhost',
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
      traefikDir: join(OVERDECK_HOME, 'traefik'),
    };
  } catch {
    return defaults;
  }
}

// ─── Port / process helpers ───────────────────────────────────────────────────

export type PortProbeExec = (command: string) => Promise<{ stdout: string | Buffer }>;

const defaultPortProbeExec: PortProbeExec = async (command) => {
  const { stdout } = await execAsync(command);
  return { stdout };
};

function parsePidList(output: string | Buffer): number[] {
  return [...new Set(String(output)
    .split(/\s+/)
    .map(value => Number(value.trim()))
    .filter(pid => Number.isInteger(pid) && pid > 0))];
}

function parseSsListenerPids(output: string | Buffer, port: number): number[] {
  const pids = new Set<number>();
  const portPattern = new RegExp(`(?:^|\\s)\\S*:${port}(?:\\s|$)`);
  for (const line of String(output).split('\n')) {
    if (!portPattern.test(line)) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      pids.add(Number(match[1]));
    }
  }
  return [...pids];
}

function isEmptyExitOne(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const failure = error as { code?: number | string; stdout?: string | Buffer };
  return Number(failure.code) === 1 && String(failure.stdout ?? '').trim() === '';
}

export async function pidsOnPort(port: number, run: PortProbeExec = defaultPortProbeExec): Promise<number[]> {
  const probes = [
    {
      tool: 'lsof',
      command: `lsof -nP -iTCP:${port} -sTCP:LISTEN -t`,
      parse: parsePidList,
      emptyExitOne: true,
    },
    {
      tool: 'fuser',
      command: `fuser ${port}/tcp`,
      parse: parsePidList,
      emptyExitOne: true,
    },
    {
      tool: 'ss',
      command: 'ss -ltnp',
      parse: (output: string | Buffer) => parseSsListenerPids(output, port),
      emptyExitOne: false,
    },
  ];

  for (const probe of probes) {
    try {
      const { stdout } = await run(probe.command);
      return probe.parse(stdout);
    } catch (error) {
      if (probe.emptyExitOne && isEmptyExitOne(error)) return [];
    }
  }

  console.warn(`[dashboard] could not inspect port ${port}; lsof, fuser, and ss all failed to execute`);
  return [];
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

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves that the pid exists but belongs to another user. Any other
    // probe failure is not positive liveness evidence and must not block the
    // replacement dashboard from starting.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitForPortFree(
  port: number,
  timeoutMs: number,
  portOwnerProbe: (port: number) => Promise<number[]> = pidsOnPort,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = await portOwnerProbe(port);
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

async function describeSurvivingPid(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o pid=,stat=,cmd=`);
    const description = stdout.trim().replace(/\s+/g, ' ');
    if (!description) return null;

    const state = description.split(' ')[1] ?? '';
    if (state.startsWith('Z') || state.startsWith('X')) return null;
    return isPidAlive(pid) ? description : null;
  } catch {
    // The process disappeared between the kill(0) sample and ps. That race used
    // to become the fatal "cmd: unknown survived SIGKILL" false positive.
    return null;
  }
}

async function fileSizeOrZero(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function readAppendedLog(path: string, offset: number): Promise<{ text: string; offset: number }> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return { text: '', offset: 0 };
  }
  const start = size < offset ? 0 : offset;
  if (size <= start) return { text: '', offset: size };

  let file: Awaited<ReturnType<typeof openFile>>;
  try {
    file = await openFile(path, 'r');
  } catch {
    return { text: '', offset: 0 };
  }
  try {
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), offset: start + bytesRead };
  } catch {
    return { text: '', offset: start };
  } finally {
    await file.close().catch(() => {});
  }
}

function createEaddrinuseProbe(
  logPath: string,
  initialOffset: number,
  port: number,
  portOwnerProbe: (port: number) => Promise<number[]>,
  pidDescriptor: (pid: number) => Promise<string>,
): () => Promise<StageError | null> {
  let offset = initialOffset;
  let carry = '';
  return async () => {
    const appended = await readAppendedLog(logPath, offset);
    offset = appended.offset;
    const text = carry + appended.text;
    carry = text.slice(-10);
    if (!/EADDRINUSE/.test(text)) return null;

    const ownerPid = (await portOwnerProbe(port))[0] ?? null;
    const owner = ownerPid === null
      ? 'an unresolved PID'
      : `PID ${ownerPid} (cmd: ${await pidDescriptor(ownerPid)})`;
    return new EaddrinuseSpawnError({
      stage: 'dashboard',
      reason: `port ${port} is owned by ${owner} — the freshly spawned server crashed with EADDRINUSE`,
    });
  };
}

async function stopDashboardPromise(
  config: PlatformConfig,
  opts: DashboardStopOptions = {},
): Promise<void> {
  const graceMs = opts.graceTimeoutMs ?? 5000;
  const ports = [config.dashboardPort, config.dashboardApiPort];
  const portOwnerProbe = opts.portOwnerProbe ?? pidsOnPort;
  const pidSurvivorProbe = opts.pidSurvivorProbe ?? describeSurvivingPid;

  // 0. If an interactive `pan dev` session owns these ports, route the stop to
  //    the supervisor itself rather than port-killing its children. The dev
  //    supervisor respawns any child that dies while it is up, so killing the
  //    children directly would race its recovery logic. SIGTERMing the
  //    supervisor sets its `shuttingDown` flag → graceful teardown, marker
  //    cleared, no respawn. (PAN: dashboard-dev-resilience)
  const dev = readDevSupervisorMarker();
  if (dev && dev.dashboardPort === config.dashboardPort && dev.apiPort === config.dashboardApiPort) {
    killPidsSync([dev.pid], 'SIGTERM');
    const freed = await Promise.all(ports.map((p) => waitForPortFree(p, graceMs, portOwnerProbe)));
    if (freed.every(Boolean)) return;
    // Supervisor failed to release the ports in time — escalate, then fall
    // through to the normal port-based teardown to mop up orphaned children.
    killPidsSync([dev.pid], 'SIGKILL');
  }

  // 1. Collect pids across both ports, then SIGTERM.
  const allPids = new Set<number>();
  for (const p of ports) {
    for (const pid of await portOwnerProbe(p)) allPids.add(pid);
  }
  if (allPids.size === 0) return;

  killPidsSync([...allPids], 'SIGTERM');

  // 2. Wait for ports to free. A process that closes its listener but survives
  // SIGTERM is still part of this teardown, so include it in the SIGKILL set.
  const freed = await Promise.all(ports.map((p) => waitForPortFree(p, graceMs, portOwnerProbe)));
  const stubbornPids = new Set([...allPids].filter(isPidAlive));
  if (!freed.every(Boolean)) {
    for (const p of ports) {
      for (const pid of await portOwnerProbe(p)) stubbornPids.add(pid);
    }
  }
  if (stubbornPids.size > 0) killPidsSync([...stubbornPids], 'SIGKILL');

  const finalFreed = await Promise.all(ports.map((p) => waitForPortFree(p, 2000, portOwnerProbe)));
  const survivorFailures: string[] = [];
  for (const pid of allPids) {
    const description = await pidSurvivorProbe(pid);
    if (description !== null) {
      survivorFailures.push(`PID ${pid} (cmd: ${description}) survived SIGKILL`);
    }
  }
  const portFailures: string[] = [];
  for (const [index, port] of ports.entries()) {
    if (finalFreed[index]) continue;
    for (const pid of await portOwnerProbe(port)) {
      portFailures.push(`port ${port} still held by PID ${pid} (cmd: ${await describePid(pid)})`);
    }
  }
  const failures = [...survivorFailures, ...portFailures];
  if (failures.length > 0) {
    const Failure = portFailures.length === 0 ? DashboardPortsReleasedError : StageError;
    throw new Failure({
      stage: 'dashboard',
      reason: failures.join('; '),
    });
  }
}async function waitForDashboardHealthPromise(
  apiPort: number,
  opts: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    expectedIdentity?: { repoRoot: string; mode: 'primary' | 'peer' };
    expectedPid?: number;
    pollFailure?: () => Promise<StageError | null>;
  } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const url = `http://127.0.0.1:${apiPort}/api/health`;
  const deadline = Date.now() + timeoutMs;

  let lastError = 'never got a response';
  let lastResponderPid: number | null = null;
  while (Date.now() < deadline) {
    const pollFailure = await opts.pollFailure?.();
    if (pollFailure) throw pollFailure;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        if (!opts.expectedIdentity && opts.expectedPid === undefined) return;
        const body = await res.json().catch(() => null) as unknown;
        const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
        const reportedPid = typeof payload.pid === 'number' && Number.isInteger(payload.pid) && payload.pid > 0
          ? payload.pid
          : null;
        if (reportedPid !== null) lastResponderPid = reportedPid;

        if (opts.expectedIdentity) {
          const repoRoot = typeof payload.repoRoot === 'string' ? payload.repoRoot : '(missing)';
          const mode = typeof payload.mode === 'string' ? payload.mode : '(missing)';
          if (repoRoot !== opts.expectedIdentity.repoRoot || mode !== opts.expectedIdentity.mode) {
            lastError = `port held by non-${opts.expectedIdentity.mode} server (cwd=${repoRoot}, mode=${mode})`;
            await sleep(pollIntervalMs);
            continue;
          }
        }

        if (opts.expectedPid !== undefined && reportedPid !== opts.expectedPid) {
          lastError =
            `port answered by pid ${reportedPid ?? '(unreported)'} — ` +
            `not the freshly spawned server (pid ${opts.expectedPid})`;
          await sleep(pollIntervalMs);
          continue;
        }
        return;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
    }
    await sleep(pollIntervalMs);
  }
  const responderDetails = lastResponderPid === null
    ? ''
    : `; responder PID ${lastResponderPid} command: ${await describePid(lastResponderPid)}`;
  throw new StageError({
    stage: 'dashboard',
    reason:
      `health check at ${url} did not pass within ${formatTimeoutMs(timeoutMs)} ` +
      `(last: ${lastError}${responderDetails})`,
  });
}async function waitForTraefikHealthPromise(
  traefikDomain: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const url = `https://${traefikDomain}/api/health`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // ignore — keep polling until deadline
    }
    await sleep(pollIntervalMs);
  }
  return false;
}async function isTraefikContainerRunningPromise(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'docker ps --filter "name=overdeck-traefik" --format "{{.Names}}" 2>/dev/null',
    );
    return stdout.trim().includes('overdeck-traefik');
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
}

export interface DashboardSpawnHandle {
  stop: () => Promise<void> | void;
  pid?: () => Promise<number | null>;
}

export interface DashboardRestartResult {
  ownershipVerified: boolean;
  spawnedPid: number | null;
}

async function restartDashboardPromise(
  config: PlatformConfig,
  startDashboardFn: () => Promise<DashboardSpawnHandle | void> | DashboardSpawnHandle | void,
  opts: {
    healthTimeoutMs?: number;
    expectedIdentity?: { repoRoot: string; mode: 'primary' | 'peer' };
    eaddrinuseLogPath?: string;
    portOwnerProbe?: (port: number) => Promise<number[]>;
    pidDescriptor?: (pid: number) => Promise<string>;
    pidSurvivorProbe?: PidSurvivorProbe;
  } = {},
): Promise<DashboardRestartResult> {
  try {
    await stopDashboardPromise(config, {
      portOwnerProbe: opts.portOwnerProbe,
      pidSurvivorProbe: opts.pidSurvivorProbe,
    });
  } catch (error) {
    if (!(error instanceof DashboardPortsReleasedError)) throw error;
    console.warn(`[dashboard] ${error.failure.reason}; ports are free, continuing restart`);
  }
  const logPath = opts.eaddrinuseLogPath ?? DASHBOARD_LOG_FILE;
  const logOffset = await fileSizeOrZero(logPath);
  const handle = await startDashboardFn();
  const spawnedPid = await handle?.pid?.() ?? null;
  const pollFailure = handle?.pid
    ? createEaddrinuseProbe(
        logPath,
        logOffset,
        config.dashboardApiPort,
        opts.portOwnerProbe ?? pidsOnPort,
        opts.pidDescriptor ?? describePid,
      )
    : undefined;
  try {
    await waitForDashboardHealthPromise(config.dashboardApiPort, {
      timeoutMs: opts.healthTimeoutMs,
      expectedIdentity: opts.expectedIdentity,
      expectedPid: spawnedPid ?? undefined,
      pollFailure,
    });
  } catch (error) {
    if (error instanceof EaddrinuseSpawnError) throw error;
    // #3099: NEVER reap the freshly spawned server on a health timeout. The old
    // policy killed the new server after a false-fast health check and exited
    // with zero listeners — a full dashboard outage caused by a slow-but-healthy
    // boot. Leaving the spawn costs nothing: a slow boot comes healthy on its
    // own, a genuinely broken one is visible for inspection, and the next
    // `pan restart` stops whatever holds the port anyway.
    const healthFailure = error instanceof Error ? error.message : String(error);
    throw new StageError({
      stage: 'dashboard',
      reason:
        `${healthFailure}; the newly spawned dashboard was LEFT RUNNING for inspection ` +
        `(it may still be booting — re-check ${config.dashboardApiPort ? `http://127.0.0.1:${config.dashboardApiPort}/api/health` : 'the health endpoint'} shortly)`,
      recovery: 'dashboard-left-running',
    });
  }
  return { ownershipVerified: spawnedPid !== null, spawnedPid };
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
    reason: `CLIProxy did not come back up within ${timeoutMs}ms — check ${join(OVERDECK_HOME, 'cliproxy', 'cliproxy.log')}`,
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

export function leavesDashboardRunning(err: unknown): boolean {
  return err instanceof StageError && err.failure.recovery === 'dashboard-left-running';
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
  opts: DashboardStopOptions = {},
): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => stopDashboardPromise(config, opts), catch: stageErrorOf('stopDashboard') });

/** Effect variant of {@link waitForDashboardHealth}. */
export const waitForDashboardHealth = (
  apiPort: number,
  opts: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    expectedIdentity?: { repoRoot: string; mode: 'primary' | 'peer' };
    expectedPid?: number;
  } = {},
): Effect.Effect<void, StageError> =>
  Effect.tryPromise({ try: () => waitForDashboardHealthPromise(apiPort, opts), catch: stageErrorOf('waitForDashboardHealth') });

/** Effect variant of {@link waitForTraefikHealth}. Returns true when Traefik serves 200. */
export const waitForTraefikHealth = (
  traefikDomain: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Effect.Effect<boolean, never> =>
  Effect.promise(() => waitForTraefikHealthPromise(traefikDomain, opts));

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
  startDashboardFn: () => Promise<DashboardSpawnHandle | void> | DashboardSpawnHandle | void,
  opts: {
    healthTimeoutMs?: number;
    expectedIdentity?: { repoRoot: string; mode: 'primary' | 'peer' };
    eaddrinuseLogPath?: string;
    portOwnerProbe?: (port: number) => Promise<number[]>;
    pidDescriptor?: (pid: number) => Promise<string>;
    pidSurvivorProbe?: PidSurvivorProbe;
  } = {},
): Effect.Effect<DashboardRestartResult, StageError> =>
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
