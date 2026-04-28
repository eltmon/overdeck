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

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import SmeeClient from 'smee-client';
import { loadConfig } from './config.js';

const SMEE_URL_PATH = join(homedir(), '.panopticon', 'github-app', 'smee-url');
const SMEE_PID_PATH = join(homedir(), '.panopticon', 'github-app', 'smee.pid');
const SMEE_LOG_PATH = join(homedir(), '.panopticon', 'logs', 'smee.log');
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
  const config = loadConfig();
  const port = config.dashboard?.api_port ?? 3011;
  return `http://localhost:${port}/api/webhooks/github`;
}

function computeRestartDelay(attempt: number): number {
  const exponential = BASE_RESTART_DELAY_MS * 2 ** attempt;
  return Math.min(exponential, MAX_RESTART_DELAY_MS);
}

function scheduleRestart(): void {
  if (isShuttingDown) return;
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
    startSmeeClient().catch((err) => {
      console.error('[smee] Restart failed:', (err as Error)?.message || String(err));
    });
  }, delay);
}

export async function startSmeeClient(): Promise<void> {
  if (activeClient) {
    console.log('[smee] Already running');
    return;
  }

  const smeeUrl = getSmeeUrl();
  if (!smeeUrl) {
    console.warn('[smee] No smee-url configured at ~/.panopticon/github-app/smee-url — skipping webhook relay');
    return;
  }

  isShuttingDown = false;
  const target = getWebhookTarget();

  const client = new SmeeClient({
    source: smeeUrl,
    target,
    logger: console,
  });

  client.onerror = (_ev) => {
    // The error event itself is logged by the logger above.
    // Schedule a restart unless we're intentionally shutting down.
    if (!isShuttingDown) {
      activeClient = null;
      scheduleRestart();
    }
  };

  try {
    await client.start();
    activeClient = client;
    restartAttempt = 0;
    console.log(`[smee] Relaying ${smeeUrl} → ${target}`);
  } catch (err) {
    console.error('[smee] Failed to start:', (err as Error)?.message || String(err));
    scheduleRestart();
  }
}

export async function stopSmeeClient(): Promise<void> {
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

export function isSmeeRunning(): boolean {
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

export function isSmeeProcessRunning(): boolean {
  const pid = readSmeePid();
  if (!pid) return false;
  if (isProcessAlive(pid)) return true;
  // Stale pidfile — clean up
  try { unlinkSync(SMEE_PID_PATH); } catch { /* ignore */ }
  return false;
}

export function startSmeeProcess(): void {
  if (isSmeeProcessRunning()) {
    console.log('[smee] Process already running');
    return;
  }

  const smeeUrl = getSmeeUrl();
  if (!smeeUrl) {
    console.warn('[smee] No smee-url configured — skipping webhook relay');
    return;
  }

  const target = getWebhookTarget();
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
    return;
  }

  writeFileSync(SMEE_PID_PATH, String(child.pid));
  child.unref();
  console.log(`[smee] Started process (PID ${child.pid}) relaying to ${target}`);
}

export function stopSmeeProcess(): void {
  const pid = readSmeePid();
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already dead
    }
  }

  try {
    if (existsSync(SMEE_PID_PATH)) {
      unlinkSync(SMEE_PID_PATH);
    }
  } catch { /* ignore */ }

  console.log('[smee] Process stopped');
}
