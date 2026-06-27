/**
 * Overdeck Supervisor lifecycle (CLI side).
 *
 * Spawns the supervisor sidecar (`dist/supervisor/server.js`) as a detached
 * child process when `pan up` runs. The supervisor exposes
 * `POST /restart-dashboard` so the dashboard frontend can request a restart
 * even when the dashboard server itself is dead and unreachable.
 *
 * Modeled on `smee.ts`: pidfile + log file, idempotent start/stop, best-effort
 * cleanup. The supervisor runs under whichever Node binary launched `pan up` —
 * it's tiny and uses only `node:http`, so it has no native-addon constraints.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Effect } from 'effect';

import { LOGS_DIR, OVERDECK_HOME, packageRoot } from './paths.js';
import { readPlatformConfigSync } from './platform-lifecycle.js';
import { ProcessSpawnError } from './errors.js';

const SUPERVISOR_PID_PATH = join(OVERDECK_HOME, 'supervisor.pid');
const SUPERVISOR_LOG_PATH = join(LOGS_DIR, 'supervisor.log');

/** Compute the supervisor's port from the configured dashboard API port. */
export function getSupervisorPortSync(): number {
  return readPlatformConfigSync().dashboardApiPort + 1;
}

/** Public URL the frontend hits for the Force Restart fallback. */
export function getSupervisorUrlSync(): string {
  return `http://127.0.0.1:${getSupervisorPortSync()}`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Sync sleep that yields the thread (never busy-spin, never execSync). */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const STOP_POLL_MS = 50;
const STOP_SIGKILL_MS = 1500;
const STOP_TOTAL_MS = 2000;

function readSupervisorPid(): number | null {
  try {
    if (!existsSync(SUPERVISOR_PID_PATH)) return null;
    const pid = parseInt(readFileSync(SUPERVISOR_PID_PATH, 'utf-8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isSupervisorRunningSync(): boolean {
  const pid = readSupervisorPid();
  return pid !== null && isProcessAlive(pid);
}

function resolveSupervisorBundle(): string {
  // Always the built bundle (dist/supervisor/server.js) so import resolution
  // works under Node 22. Resolve from packageRoot — robust across every
  // invocation context (CLI bundle in dist/, dashboard server in
  // dist/dashboard/, dev src/lib). The prior import.meta.url-relative candidates
  // only handled dist/lib + src/lib, so when this code was bundled into the
  // `pan` CLI (here=dist/) they pointed at `<repo>/../dist/...` and never found
  // the bundle — leaving the supervisor sidecar silently un-started so agent
  // delivery fell back to legacy tmux paste. packageRoot is the same primitive
  // agents.ts uses to locate dist/pty-supervisor.js.
  const bundle = join(packageRoot, 'dist', 'supervisor', 'server.js');
  if (existsSync(bundle)) return bundle;
  throw new Error(`Supervisor bundle not found at ${bundle}. Run \`npm run build\`.`);
}

/** Idempotent start. No-op if the supervisor is already running. */
export function startSupervisorProcessSync(): void {
  if (isSupervisorRunningSync()) return;

  // Stale pidfile from a previous crash — clear it so writeFile below succeeds cleanly.
  try {
    if (existsSync(SUPERVISOR_PID_PATH)) unlinkSync(SUPERVISOR_PID_PATH);
  } catch {
    // ignore
  }

  let bundle: string;
  try {
    bundle = resolveSupervisorBundle();
  } catch (err) {
    console.error('[supervisor]', err instanceof Error ? err.message : err);
    return;
  }

  mkdirSync(LOGS_DIR, { recursive: true });
  let logFd: number;
  try {
    logFd = openSync(SUPERVISOR_LOG_PATH, 'a');
  } catch {
    logFd = openSync('/dev/null', 'w');
  }

  const port = getSupervisorPortSync();
  const child = spawn(process.execPath, [bundle], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      OVERDECK_SUPERVISOR_PORT: String(port),
    },
  });

  if (!child.pid) {
    console.error('[supervisor] failed to spawn');
    try {
      closeSync(logFd);
    } catch {
      // ignore
    }
    return;
  }

  writeFileSync(SUPERVISOR_PID_PATH, String(child.pid));

  // Give the child a moment to either come up or crash (e.g. port still held).
  sleepMs(150);
  if (!isProcessAlive(child.pid)) {
    console.error(
      `[supervisor] child ${child.pid} exited immediately; the supervisor port may still be held by a previous instance`,
    );
    try {
      unlinkSync(SUPERVISOR_PID_PATH);
    } catch {
      // ignore
    }
    try {
      closeSync(logFd);
    } catch {
      // ignore
    }
    return;
  }

  child.unref();
  try {
    closeSync(logFd);
  } catch {
    // ignore
  }
}

export function stopSupervisorProcessSync(): void {
  const pid = readSupervisorPid();
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already dead
    }
    let sentKill = false;
    for (let waited = 0; waited < STOP_TOTAL_MS; waited += STOP_POLL_MS) {
      if (!isProcessAlive(pid)) break;
      if (!sentKill && waited >= STOP_SIGKILL_MS) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already dead
        }
        sentKill = true;
      }
      sleepMs(STOP_POLL_MS);
    }
  }
  try {
    if (existsSync(SUPERVISOR_PID_PATH)) unlinkSync(SUPERVISOR_PID_PATH);
  } catch {
    // ignore
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Read the configured supervisor port. Pure. */
export const getSupervisorPort = (): Effect.Effect<number> =>
  Effect.sync(() => getSupervisorPortSync());

/** Public URL the frontend hits for the Force Restart fallback. Pure. */
export const getSupervisorUrl = (): Effect.Effect<string> =>
  Effect.sync(() => getSupervisorUrlSync());

/** Liveness probe — true if the supervisor pid file maps to a live process. */
export const isSupervisorRunning = (): Effect.Effect<boolean> =>
  Effect.sync(() => isSupervisorRunningSync());

/**
 * Idempotently start the supervisor sidecar. Fails with ProcessSpawnError
 * if the supervisor bundle could not be resolved or the child failed to
 * detach. Successful no-op when already running.
 */
export const startSupervisorProcess = (): Effect.Effect<void, ProcessSpawnError> =>
  Effect.try({
    try: () => startSupervisorProcessSync(),
    catch: (cause) =>
      new ProcessSpawnError({
        command: process.execPath,
        args: ['<supervisor-bundle>'],
        message: 'startSupervisorProcess failed',
        cause,
      }),
  });

/** Stop the supervisor sidecar and remove its pid file. */
export const stopSupervisorProcess = (): Effect.Effect<void> =>
  Effect.sync(() => stopSupervisorProcessSync());
