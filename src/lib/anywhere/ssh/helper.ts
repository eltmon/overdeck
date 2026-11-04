/**
 * Remote SSH helper: `pan machines ssh-helper start|stop` (PAN-4404 WI-4).
 *
 * This code runs **on the SSH host**, started over SSH by the linking server
 * (D-4404-1). It holds all remote-side logic so the command line sent over SSH
 * never carries operator input:
 *
 * - **Remote lock** `${OVERDECK_HOME}/ssh-launch/lock`, a directory created with
 *   `mkdir` (atomic). It serializes helpers from any number of linking machines;
 *   a lock older than 180 s is stale and broken once. Waiting gives up after 30 s
 *   with `busy`.
 * - **Start** (D-4404-7): adopt the dashboard that answers `/api/health` on the
 *   configured API port, or run `pan up --detach --no-open --skip-traefik`, wait
 *   for health and write the launch marker `${OVERDECK_HOME}/ssh-launch/server.json`
 *   (0600). `managed` = the marker names this linker and the health pid;
 *   anything else is `external`. With pairing, mint a one-time pairing credential
 *   from the host's own dashboard with the internal token.
 * - **Stop** (D-4404-8, D-4861-1): when the marker still proves this linker
 *   started the dashboard and no other machine holds an active link to it,
 *   stop the supervisor first (the systemd unit or the supervisor.pid
 *   process, as `pan down` does), confirm nothing answers on its port, then
 *   signal the dashboard. Other sidecars that `pan up` started are left
 *   running; `pan down` is not used.
 *
 * Every dependency is injectable so the tests run on fake timers and an
 * in-memory file system. A server that answers `/api/health` with any status
 * and a numeric `pid` (an "incoherent" 503 included) counts as running, so the
 * helper never starts a second server on a port that is already taken.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SSH_HELPER_PROTOCOL, type SshLaunch } from '@overdeck/contracts';

import { UUID_V4_LOWERCASE } from '../../environment-identity.js';
import { ensureInternalToken, INTERNAL_TOKEN_HEADER } from '../../internal-token.js';
import { getOverdeckHome } from '../../paths.js';
import { readPlatformConfig } from '../../platform-lifecycle.js';
import { getSupervisorPort, stopSupervisorProcess } from '../../supervisor.js';
import { stopSupervisorUnitIfActive } from '../../systemd.js';
import type { HelperFailure, HelperResult, HelperStartResult, HelperStopReason, HelperStopResult } from './target.js';

export const LOCK_STALE_MS = 180_000;
export const LOCK_WAIT_MS = 30_000;
export const LOCK_POLL_MS = 500;
export const PAN_UP_EXIT_TIMEOUT_MS = 120_000;
export const HEALTH_WAIT_MS = 30_000;
export const HEALTH_POLL_MS = 500;
export const STOP_GRACE_MS = 10_000;
export const STOP_POLL_MS = 250;
export const SUPERVISOR_STOP_WAIT_MS = 3_000;
const HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const OUTPUT_TAIL_LINES = 20;

/** Helper error codes. The linking side maps all but `busy` and `start-failed` to `helper-failed`. */
export type HelperErrorCode = 'busy' | 'start-failed' | 'pair-failed' | 'token-rejected' | 'stop-failed' | 'bad-linker';

export interface LaunchMarker {
  v: 1;
  pid: number;
  apiPort: number;
  version: string;
  startedAt: string;
  startedBy: string;
}

export interface PanUpResult {
  exitCode: number | null;
  /** The last lines `pan up` printed (stdout and stderr). */
  output: string[];
}

export interface HelperFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, mode: number): Promise<void>;
  mkdir(path: string, opts: { recursive?: boolean; mode?: number }): Promise<unknown>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ mtimeMs: number }>;
}

export interface HelperDeps {
  fetch: typeof fetch;
  /** Run `pan up --detach --no-open --skip-traefik` and wait for it to exit. */
  spawnPanUp(): Promise<PanUpResult>;
  kill(pid: number, signal: NodeJS.Signals): void;
  isAlive(pid: number): boolean;
  fs: HelperFs;
  now(): number;
  overdeckHome: string;
  apiPort: number;
  internalToken(): string;
  panVersion: string;
  /** The host's supervisor port (dashboard API port + 1). */
  supervisorPort: number;
  /**
   * Stop the host's supervisor the way `pan down` does: the systemd user unit
   * when it is active, else the process in `${OVERDECK_HOME}/supervisor.pid`.
   */
  stopSupervisor(): Promise<void>;
}

const nodeFs: HelperFs = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, data, mode) => writeFile(path, data, { mode }),
  mkdir: (path, opts) => mkdir(path, opts),
  rmdir: (path) => rmdir(path),
  unlink: (path) => unlink(path),
  stat: (path) => stat(path),
};

function tailLines(text: string, count: number): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(-count);
}

/**
 * Spawn `pan up` with piped output (never `inherit`: a sidecar it leaves running
 * would hold the SSH session's stdout open) and wait for the child's `exit`
 * event, not `close`, for the same reason.
 */
function spawnPanUpDefault(): Promise<PanUpResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1] ?? '', 'up', '--detach', '--no-open', '--skip-traefik'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-16_384);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
      resolve({ exitCode, output: tailLines(output, OUTPUT_TAIL_LINES) });
    };
    const timer = setTimeout(() => finish(null), PAN_UP_EXIT_TIMEOUT_MS);
    child.once('exit', (code) => finish(code));
    child.once('error', (error) => {
      output += `\n${error.message}`;
      finish(null);
    });
  });
}

function isAliveDefault(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** D-4861-1: the same supervisor stop as `pan down`. The helper runs only in the CLI, so the sync process stop is allowed (D-4861-7). */
async function stopSupervisorDefault(): Promise<void> {
  if (await stopSupervisorUnitIfActive()) return;
  stopSupervisorProcess();
}

/** True when a supervisor answers `GET /health` with `ok: true` on the supervisor port. */
async function supervisorAnswers(deps: HelperDeps): Promise<boolean> {
  try {
    const response = await deps.fetch(`http://127.0.0.1:${deps.supervisorPort}/health`, {
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return response.ok && body?.ok === true;
  } catch {
    return false;
  }
}

/** Production dependencies: real fetch, fs and processes; ports and token from this host's OVERDECK_HOME. */
export function defaultHelperDeps(panVersion: string): HelperDeps {
  return {
    fetch: globalThis.fetch,
    spawnPanUp: spawnPanUpDefault,
    kill: (pid, signal) => process.kill(pid, signal),
    isAlive: isAliveDefault,
    fs: nodeFs,
    now: () => Date.now(),
    overdeckHome: getOverdeckHome(),
    apiPort: readPlatformConfig().dashboardApiPort,
    internalToken: ensureInternalToken,
    panVersion,
    supervisorPort: getSupervisorPort(),
    stopSupervisor: stopSupervisorDefault,
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function failure(error: HelperErrorCode, message: string): HelperFailure {
  return { v: SSH_HELPER_PROTOCOL, ok: false, error, message };
}

function launchDir(deps: HelperDeps): string {
  return join(deps.overdeckHome, 'ssh-launch');
}

function markerPath(deps: HelperDeps): string {
  return join(launchDir(deps), 'server.json');
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

// ── Remote lock ───────────────────────────────────────────────────────────

/** Take the remote lock. False when another helper still holds it after 30 s. */
async function acquireLock(deps: HelperDeps): Promise<boolean> {
  const lock = join(launchDir(deps), 'lock');
  await deps.fs.mkdir(launchDir(deps), { recursive: true, mode: 0o700 });
  const deadline = deps.now() + LOCK_WAIT_MS;
  let brokeStale = false;
  for (;;) {
    try {
      await deps.fs.mkdir(lock, { mode: 0o700 });
      return true;
    } catch (error) {
      if (errnoCode(error) !== 'EEXIST') throw error;
    }
    if (!brokeStale) {
      const mtimeMs = await deps.fs.stat(lock).then((info) => info.mtimeMs, () => null);
      if (mtimeMs !== null && deps.now() - mtimeMs > LOCK_STALE_MS) {
        brokeStale = true;
        await deps.fs.rmdir(lock).catch(() => undefined);
        continue;
      }
    }
    if (deps.now() >= deadline) return false;
    await sleep(LOCK_POLL_MS);
  }
}

async function releaseLock(deps: HelperDeps): Promise<void> {
  await deps.fs.rmdir(join(launchDir(deps), 'lock')).catch(() => undefined);
}

async function withLock(deps: HelperDeps, run: () => Promise<HelperResult>): Promise<HelperResult> {
  if (!(await acquireLock(deps))) {
    return failure('busy', 'another Overdeck machine is setting up this host; try again in a minute');
  }
  try {
    return await run();
  } finally {
    await releaseLock(deps);
  }
}

// ── Health and marker ─────────────────────────────────────────────────────

function localUrl(deps: HelperDeps, path: string): string {
  return `http://127.0.0.1:${deps.apiPort}${path}`;
}

/** The pid of the dashboard answering `/api/health`, or null when none answers. */
async function readHealthPid(deps: HelperDeps): Promise<number | null> {
  try {
    const response = await deps.fetch(localUrl(deps, '/api/health'), { signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS) });
    const body = (await response.json().catch(() => null)) as { pid?: unknown } | null;
    return typeof body?.pid === 'number' && Number.isInteger(body.pid) && body.pid > 0 ? body.pid : null;
  } catch {
    return null;
  }
}

function isMarker(value: unknown): value is LaunchMarker {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    m.v === 1 &&
    typeof m.pid === 'number' &&
    typeof m.apiPort === 'number' &&
    typeof m.version === 'string' &&
    typeof m.startedAt === 'string' &&
    typeof m.startedBy === 'string'
  );
}

/** The launch marker, or null when it is missing or unreadable. */
async function readMarker(deps: HelperDeps): Promise<LaunchMarker | null> {
  try {
    const parsed: unknown = JSON.parse(await deps.fs.readFile(markerPath(deps)));
    return isMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteMarker(deps: HelperDeps): Promise<void> {
  await deps.fs.unlink(markerPath(deps)).catch(() => undefined);
}

async function writeMarker(deps: HelperDeps, marker: LaunchMarker): Promise<void> {
  // Remove first: a write mode applies only when the file is created.
  await deleteMarker(deps);
  await deps.fs.writeFile(markerPath(deps), `${JSON.stringify(marker)}\n`, 0o600);
}

async function waitForHealthPid(deps: HelperDeps): Promise<number | null> {
  const deadline = deps.now() + HEALTH_WAIT_MS;
  for (;;) {
    const pid = await readHealthPid(deps);
    if (pid !== null) return pid;
    if (deps.now() >= deadline) return null;
    await sleep(HEALTH_POLL_MS);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────

export interface HelperStartInput {
  linker: string;
  /** Mint a pairing credential (false with `--no-pair`). */
  pair: boolean;
}

/** D-4404-7: adopt or start the dashboard, then report it (and a pairing credential). */
export function runHelperStart(input: HelperStartInput, deps: HelperDeps): Promise<HelperResult> {
  if (!UUID_V4_LOWERCASE.test(input.linker)) {
    return Promise.resolve(failure('bad-linker', '--linker must be an environment id (a lowercase UUID)'));
  }
  return withLock(deps, () => startLocked(input, deps));
}

async function startLocked(input: HelperStartInput, deps: HelperDeps): Promise<HelperResult> {
  let launch: SshLaunch;
  const healthPid = await readHealthPid(deps);
  if (healthPid !== null) {
    const marker = await readMarker(deps);
    if (marker && marker.pid !== healthPid) await deleteMarker(deps);
    launch = marker && marker.startedBy === input.linker && marker.pid === healthPid ? 'managed' : 'external';
  } else {
    const upResult = await deps.spawnPanUp();
    const pid = await waitForHealthPid(deps);
    if (pid === null) {
      const tail = upResult.output.slice(-OUTPUT_TAIL_LINES).join('\n');
      return failure(
        'start-failed',
        `pan up did not bring the dashboard up on port ${deps.apiPort}${upResult.exitCode === null ? '' : ` (pan up exited ${upResult.exitCode})`}${tail ? `:\n${tail}` : '.'}`,
      );
    }
    await writeMarker(deps, {
      v: 1,
      pid,
      apiPort: deps.apiPort,
      version: deps.panVersion,
      startedAt: new Date(deps.now()).toISOString(),
      startedBy: input.linker,
    });
    launch = 'managed';
  }

  let environment: { environmentId?: unknown; label?: unknown; serverVersion?: unknown };
  try {
    const response = await deps.fetch(localUrl(deps, '/api/environment'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    environment = (await response.json()) as typeof environment;
  } catch (error) {
    return failure('start-failed', `The dashboard on port ${deps.apiPort} did not describe itself: ${(error as Error).message}`);
  }
  if (typeof environment.environmentId !== 'string' || typeof environment.label !== 'string' || typeof environment.serverVersion !== 'string') {
    return failure('start-failed', `The dashboard on port ${deps.apiPort} answered /api/environment without an identity`);
  }

  let pairing: HelperStartResult['pairing'] = null;
  if (input.pair) {
    let response: Response;
    try {
      response = await deps.fetch(localUrl(deps, '/api/pairing/credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [INTERNAL_TOKEN_HEADER]: deps.internalToken() },
        body: '{}',
      });
    } catch (error) {
      return failure('pair-failed', `Could not ask the dashboard for a pairing credential: ${(error as Error).message}`);
    }
    if (response.status === 401) {
      return failure('token-rejected', 'The dashboard rejected this host\'s internal token (was it started with pan serve instead of pan up?)');
    }
    if (!response.ok) return failure('pair-failed', `The dashboard refused a pairing credential (HTTP ${response.status})`);
    const body = (await response.json().catch(() => null)) as { credential?: unknown; expiresAt?: unknown } | null;
    if (typeof body?.credential !== 'string' || typeof body.expiresAt !== 'string') {
      return failure('pair-failed', 'The dashboard answered the pairing request without a credential');
    }
    pairing = { credential: body.credential, expiresAt: body.expiresAt };
  }

  return {
    v: SSH_HELPER_PROTOCOL,
    ok: true,
    op: 'start',
    launch,
    apiPort: deps.apiPort,
    environmentId: environment.environmentId,
    label: environment.label,
    serverVersion: environment.serverVersion,
    panVersion: deps.panVersion,
    pairing,
  };
}

// ── Stop ──────────────────────────────────────────────────────────────────

function stopped(stoppedServer: boolean, reason: HelperStopReason): HelperStopResult {
  return { v: SSH_HELPER_PROTOCOL, ok: true, op: 'stop', stopped: stoppedServer, reason };
}

/** D-4404-8: stop the dashboard only when this linker provably started it and nobody else uses it. */
export function runHelperStop(input: { linker: string }, deps: HelperDeps): Promise<HelperResult> {
  if (!UUID_V4_LOWERCASE.test(input.linker)) {
    return Promise.resolve(failure('bad-linker', '--linker must be an environment id (a lowercase UUID)'));
  }
  return withLock(deps, () => stopLocked(input.linker, deps));
}

async function stopLocked(linker: string, deps: HelperDeps): Promise<HelperResult> {
  const healthPid = await readHealthPid(deps);
  if (healthPid === null) {
    await deleteMarker(deps);
    return stopped(false, 'not-running');
  }
  const marker = await readMarker(deps);
  if (!marker || marker.startedBy !== linker) return stopped(false, 'external');
  if (marker.pid !== healthPid) {
    await deleteMarker(deps);
    return stopped(false, 'restarted');
  }

  let response: Response;
  try {
    response = await deps.fetch(localUrl(deps, '/api/machines'), { headers: { [INTERNAL_TOKEN_HEADER]: deps.internalToken() } });
  } catch (error) {
    return failure('stop-failed', `Could not list the machines linked to this host: ${(error as Error).message}`);
  }
  if (response.status === 401) return failure('token-rejected', 'The dashboard rejected this host\'s internal token');
  if (!response.ok) return failure('stop-failed', `Could not list the machines linked to this host (HTTP ${response.status})`);
  const body = (await response.json().catch(() => null)) as { inbound?: unknown } | null;
  if (!Array.isArray(body?.inbound)) return failure('stop-failed', 'The machines list had no inbound section');
  const others = body.inbound.some(
    (entry) => typeof entry === 'object' && entry !== null && (entry as { environmentId?: unknown }).environmentId !== linker,
  );
  if (others) return stopped(false, 'in-use');

  // D-4861-1: the supervisor restarts a dashboard it watches, so it goes first.
  try {
    await deps.stopSupervisor();
  } catch (error) {
    return failure('stop-failed', `Could not stop the supervisor on this host: ${(error as Error).message}`);
  }
  const supervisorDeadline = deps.now() + SUPERVISOR_STOP_WAIT_MS;
  while ((await supervisorAnswers(deps)) && deps.now() < supervisorDeadline) await sleep(STOP_POLL_MS);
  if (await supervisorAnswers(deps)) {
    return failure(
      'stop-failed',
      `A supervisor still answers on port ${deps.supervisorPort} (on a Mac, the launchd agent ai.overdeck.supervisor that pan connect loads). It would restart the dashboard, so the server was left running.`,
    );
  }

  try {
    deps.kill(healthPid, 'SIGTERM');
  } catch (error) {
    if (errnoCode(error) !== 'ESRCH') throw error;
  }
  const deadline = deps.now() + STOP_GRACE_MS;
  while (deps.isAlive(healthPid) && deps.now() < deadline) await sleep(STOP_POLL_MS);
  if (deps.isAlive(healthPid)) {
    try {
      deps.kill(healthPid, 'SIGKILL');
    } catch (error) {
      if (errnoCode(error) !== 'ESRCH') throw error;
    }
  }
  await deleteMarker(deps);
  return stopped(true, 'stopped');
}
