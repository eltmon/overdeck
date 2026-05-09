/**
 * Panopticon Supervisor lifecycle (CLI side).
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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOGS_DIR, PANOPTICON_HOME } from './paths.js';
import { readPlatformConfig } from './platform-lifecycle.js';

const SUPERVISOR_PID_PATH = join(PANOPTICON_HOME, 'supervisor.pid');
const SUPERVISOR_LOG_PATH = join(LOGS_DIR, 'supervisor.log');

/** Compute the supervisor's port from the configured dashboard API port. */
export function getSupervisorPort(): number {
  return readPlatformConfig().dashboardApiPort + 1;
}

/** Public URL the frontend hits for the Force Restart fallback. */
export function getSupervisorUrl(): string {
  return `http://127.0.0.1:${getSupervisorPort()}`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readSupervisorPid(): number | null {
  try {
    if (!existsSync(SUPERVISOR_PID_PATH)) return null;
    const pid = parseInt(readFileSync(SUPERVISOR_PID_PATH, 'utf-8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isSupervisorRunning(): boolean {
  const pid = readSupervisorPid();
  return pid !== null && isProcessAlive(pid);
}

function resolveSupervisorBundle(): string {
  // From src/lib in dev → src/supervisor/server.ts is the source.
  // From dist/lib in prod → dist/supervisor/server.js is the bundle.
  // We always run the built bundle so import resolution works under Node 22.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', 'supervisor', 'server.js'),         // dist/lib → dist/supervisor
    join(here, '..', '..', 'dist', 'supervisor', 'server.js'),  // src/lib → dist/supervisor
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Supervisor bundle not found. Run \`npm run build\`. Searched:\n  - ${candidates.join('\n  - ')}`,
  );
}

/** Idempotent start. No-op if the supervisor is already running. */
export function startSupervisorProcess(): void {
  if (isSupervisorRunning()) return;

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

  const port = getSupervisorPort();
  const child = spawn(process.execPath, [bundle], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      PANOPTICON_SUPERVISOR_PORT: String(port),
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
  child.unref();
  try {
    closeSync(logFd);
  } catch {
    // ignore
  }
}

export function stopSupervisorProcess(): void {
  const pid = readSupervisorPid();
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already dead
    }
  }
  try {
    if (existsSync(SUPERVISOR_PID_PATH)) unlinkSync(SUPERVISOR_PID_PATH);
  } catch {
    // ignore
  }
}
