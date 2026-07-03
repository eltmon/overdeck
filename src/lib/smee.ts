/**
 * Smee-client process management (PAN-905)
 *
 * Manages a singleton smee-client instance that relays GitHub webhooks
 * from smee.io to the local dashboard webhook endpoint.
 *
 * Library mode (in-process):
 *   await startSmeeClient();
 *   await stopSmeeClient();
 *   isSmeeRunning();
 *
 * CLI mode (detached subprocess):
 *   startSmeeProcess();
 *   stopSmeeProcess();
 *   isSmeeProcessRunning();
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import SmeeClient from 'smee-client';
import { Effect } from 'effect';
import { loadConfigSync } from './config.js';
import { ProcessSpawnError } from './errors.js';

const SMEE_URL_PATH = join(homedir(), '.overdeck', 'github-app', 'smee-url');
const SMEE_PID_PATH = join(homedir(), '.overdeck', 'github-app', 'smee.pid');
const SMEE_LOG_PATH = join(homedir(), '.overdeck', 'logs', 'smee.log');
const MAX_RESTART_ATTEMPTS = 5;
const BASE_RESTART_DELAY_MS = 1_000;
const MAX_RESTART_DELAY_MS = 30_000;

let activeClient: SmeeClient | null = null;
let restartTimeout: NodeJS.Timeout | null = null;
let restartAttempt = 0;
let isShuttingDown = false;

function getSmeeUrl(): string | null {
  try {
    if (!existsSync(SMEE_URL_PATH)) return null;
    return readFileSync(SMEE_URL_PATH, 'utf-8').trim();
  } catch {
    return null;
  }
}

function getWebhookTarget(): string {
  const config = loadConfigSync();
  const port = config.dashboard?.api_port ?? 3011;
  return `http://localhost:${port}/api/webhooks/github`;
}

function computeRestartDelay(attempt: number): number {
  const exponential = BASE_RESTART_DELAY_MS * 2 ** attempt;
  return Math.min(exponential, MAX_RESTART_DELAY_MS);
}

function scheduleRestart(): void {
  if (isShuttingDown) return;
  if (restartTimeout !== null) return; // Already scheduled
  if (restartAttempt >= MAX_RESTART_ATTEMPTS) {
    console.error('[smee] Max restart attempts reached — giving up');
    activeClient = null;
    return;
  }

  const delay = computeRestartDelay(restartAttempt);
  restartAttempt++;
  console.log(`[smee] Restarting in ${delay}ms (attempt ${restartAttempt}/${MAX_RESTART_ATTEMPTS})`);

  restartTimeout = setTimeout(() => {
    restartTimeout = null;
    Effect.runPromise(startSmeeClient()).catch((err) => {
      console.error('[smee] Restart failed:', (err as Error)?.message || String(err));
    });
  }, delay);
}async function startSmeeClientPromise(): Promise<void> {
  if (activeClient) {
    console.log('[smee] Already running');
    return;
  }

  const smeeUrl = getSmeeUrl();
  if (!smeeUrl) {
    console.warn('[smee] No smee-url configured at ~/.overdeck/github-app/smee-url — skipping webhook relay');
    return;
  }

  isShuttingDown = false;
  const target = getWebhookTarget();

  const client = new SmeeClient({
    source: smeeUrl,
    target,
    logger: console,
  });

  try {
    await client.start();
    activeClient = client;
    restartAttempt = 0;
    console.log(`[smee] Relaying ${smeeUrl} → ${target}`);

    // Only wire onerror AFTER start succeeds — pre-start errors are handled
    // by the catch block. Post-start onerror handles runtime disconnects.
    client.onerror = (_ev) => {
      // The error event itself is logged by the logger above.
      // Schedule a restart unless we're intentionally shutting down.
      if (!isShuttingDown) {
        activeClient = null;
        scheduleRestart();
      }
    };
  } catch (err) {
    console.error('[smee] Failed to start:', (err as Error)?.message || String(err));
    scheduleRestart();
  }
}async function stopSmeeClientPromise(): Promise<void> {
  isShuttingDown = true;

  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }

  if (activeClient) {
    try {
      await activeClient.stop();
    } catch (err) {
      console.error('[smee] Error stopping client:', (err as Error)?.message || String(err));
    }
    activeClient = null;
  }

  restartAttempt = 0;
  console.log('[smee] Stopped');
}

export function isSmeeRunningSync(): boolean {
  return activeClient !== null;
}

// ─── CLI process mode (detached subprocess) ──────────────────────────────────

function getSmeeBinaryPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return join(moduleDir, '..', '..', 'node_modules', 'smee-client', 'bin', 'smee.js');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readSmeePid(): number | null {
  try {
    if (!existsSync(SMEE_PID_PATH)) return null;
    const pid = parseInt(readFileSync(SMEE_PID_PATH, 'utf-8').trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function readProcessArgv(pid: number): string[] | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`);
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    const argv = text.split('\0').filter(Boolean);
    return argv.length > 0 ? argv : null;
  } catch {
    return null;
  }
}

function isSmeeCommand(argv: string[]): boolean {
  return argv.some((arg) => arg.includes('node_modules/smee-client/bin/smee.js'));
}

function hasArgValue(argv: string[], flag: string, value: string): boolean {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] === value;
}

function isMatchingSmeeProcess(pid: number, smeeUrl: string, target: string): boolean | null {
  const argv = readProcessArgv(pid);
  if (!argv) return null;
  return isSmeeCommand(argv) && hasArgValue(argv, '--url', smeeUrl) && hasArgValue(argv, '--target', target);
}

function findMatchingSmeeProcesses(smeeUrl: string, target: string): number[] {
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return [];
  }

  return entries
    .map((entry) => Number(entry))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .filter((pid) => isMatchingSmeeProcess(pid, smeeUrl, target) === true)
    .sort((a, b) => a - b);
}

function clearSmeePidfile(): void {
  try { unlinkSync(SMEE_PID_PATH); } catch { /* ignore */ }
}

function terminateProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already dead
  }
}

export function isSmeeProcessRunningSync(): boolean {
  const pid = readSmeePid();
  if (!pid) return false;
  if (!isProcessAlive(pid)) {
    clearSmeePidfile();
    return false;
  }

  const smeeUrl = getSmeeUrl();
  if (!smeeUrl) return true;

  const match = isMatchingSmeeProcess(pid, smeeUrl, getWebhookTarget());
  if (match === true || match === null) return true;

  // The pidfile points at a live process, but not this relay. Treat it as stale
  // so PID reuse cannot block a needed webhook relay.
  clearSmeePidfile();
  return false;
}

function reconcileExistingSmeeProcesses(smeeUrl: string, target: string): number | null {
  const matchingPids = findMatchingSmeeProcesses(smeeUrl, target);
  if (matchingPids.length === 0) return null;

  const pidfilePid = readSmeePid();
  const ownerPid = pidfilePid !== null && matchingPids.includes(pidfilePid)
    ? pidfilePid
    : matchingPids[0];

  for (const pid of matchingPids) {
    if (pid !== ownerPid) terminateProcess(pid);
  }

  writeFileSync(SMEE_PID_PATH, String(ownerPid));
  if (matchingPids.length > 1) {
    const duplicatePids = matchingPids.filter((pid) => pid !== ownerPid).join(', ');
    console.warn(`[smee] Removed duplicate process(es): ${duplicatePids}`);
  }

  return ownerPid;
}

function removeStaleOrWrongPidfile(smeeUrl: string, target: string): void {
  const pid = readSmeePid();
  if (!pid) return;
  if (!isProcessAlive(pid)) {
    clearSmeePidfile();
    return;
  }

  const match = isMatchingSmeeProcess(pid, smeeUrl, target);
  if (match === false) clearSmeePidfile();
}

export function startSmeeProcessSync(): void {
  const smeeUrl = getSmeeUrl();
  if (!smeeUrl) {
    console.warn('[smee] No smee-url configured — skipping webhook relay');
    return;
  }

  const target = getWebhookTarget();
  const existingPid = reconcileExistingSmeeProcesses(smeeUrl, target);
  if (existingPid !== null) {
    console.log('[smee] Process already running');
    return;
  }
  removeStaleOrWrongPidfile(smeeUrl, target);

  const smeeBin = getSmeeBinaryPath();

  let logFd: number;
  try {
    logFd = openSync(SMEE_LOG_PATH, 'a');
  } catch {
    console.warn('[smee] Could not open log file — using ignore stdio');
    logFd = openSync('/dev/null', 'w');
  }

  const child = spawn(process.execPath, [smeeBin, '--url', smeeUrl, '--target', target], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });

  if (!child.pid) {
    console.error('[smee] Failed to spawn smee process');
    try { closeSync(logFd); } catch { /* ignore */ }
    return;
  }

  writeFileSync(SMEE_PID_PATH, String(child.pid));
  child.unref();
  try { closeSync(logFd); } catch { /* ignore */ }
  console.log(`[smee] Started process (PID ${child.pid}) relaying to ${target}`);
}

export function stopSmeeProcessSync(): void {
  const smeeUrl = getSmeeUrl();
  const target = smeeUrl ? getWebhookTarget() : null;
  const matchingPids = smeeUrl && target ? findMatchingSmeeProcesses(smeeUrl, target) : [];
  const pid = readSmeePid();
  const pidsToStop = new Set<number>(matchingPids);
  if (pid) pidsToStop.add(pid);

  for (const pidToStop of pidsToStop) {
    if (isProcessAlive(pidToStop)) terminateProcess(pidToStop);
  }

  try {
    if (existsSync(SMEE_PID_PATH)) {
      unlinkSync(SMEE_PID_PATH);
    }
  } catch { /* ignore */ }

  console.log('[smee] Process stopped');
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Start the in-process smee client. Library mode. */
export const startSmeeClient = (): Effect.Effect<void, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => startSmeeClientPromise(),
    catch: (cause) =>
      new ProcessSpawnError({
        command: 'smee-client',
        args: [],
        message: 'startSmeeClient failed',
        cause,
      }),
  });

/** Stop the in-process smee client. Library mode. */
export const stopSmeeClient = (): Effect.Effect<void, ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => stopSmeeClientPromise(),
    catch: (cause) =>
      new ProcessSpawnError({
        command: 'smee-client',
        args: [],
        message: 'stopSmeeClient failed',
        cause,
      }),
  });

/** Liveness probe — true if the in-process client is connected. */
export const isSmeeRunning = (): Effect.Effect<boolean> =>
  Effect.sync(() => isSmeeRunningSync());

/** Start the detached smee subprocess (idempotent). */
export const startSmeeProcess = (): Effect.Effect<void> =>
  Effect.sync(() => startSmeeProcessSync());

/** Stop the detached smee subprocess and clean up the pid file. */
export const stopSmeeProcess = (): Effect.Effect<void> =>
  Effect.sync(() => stopSmeeProcessSync());

/** Probe the smee subprocess via its pidfile. */
export const isSmeeProcessRunning = (): Effect.Effect<boolean> =>
  Effect.sync(() => isSmeeProcessRunningSync());
