/**
 * TLDR Daemon Service
 *
 * Manages llm-tldr daemon lifecycle for project root and workspaces.
 * Provides code analysis and summarization for token-efficient agent work.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, writeFileSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { FsError } from './errors.js';

// ============================================================================
// TLDR Session Metrics (PAN-236)
// ============================================================================

/**
 * Per-session TLDR metrics — delta since last captured cost event.
 *
 * Metrics are file-based, stored in <workspace>/.tldr/:
 *   interceptions.log — written by tldr-read-enforcer on each TLDR serve
 *   bypasses.log      — written by tldr-read-enforcer on each deliberate bypass
 *   metrics-checkpoint.json — tracks byte offsets for delta (per-cost-event) reporting
 */
export interface TldrSessionMetrics {
  interceptions: number;                   // TLDR summaries served since last checkpoint
  bypasses: number;                        // TLDR bypasses since last checkpoint
  estimatedTokensSaved: number;            // Rough token savings (fullTokens - ~1000 per interception)
  filesAnalyzed: string[];                 // Unique files summarized in this window
  bypassReasons: Record<string, number>;   // e.g. { "offset-limit": 3, "recently-edited": 1 }
}

/** Checkpoint persisted to .tldr/metrics-checkpoint.json */
interface TldrMetricsCheckpoint {
  interceptionsLine?: number;
  bypassesLine?: number;
  interceptionsByte?: number;
  bypassesByte?: number;
  capturedAt: string;
}

function readMetricsCheckpoint(checkpointFile: string): TldrMetricsCheckpoint | null {
  if (!existsSync(checkpointFile)) return null;
  try {
    return JSON.parse(readFileSync(checkpointFile, 'utf-8')) as TldrMetricsCheckpoint;
  } catch {
    return null;
  }
}

function readLogLines(logFile: string, startByte?: number, startLine = 0): { lines: string[]; size: number } {
  if (!existsSync(logFile)) return { lines: [], size: 0 };
  const size = statSync(logFile).size;
  if (startByte !== undefined) {
    const safeStart = startByte <= size ? Math.max(0, startByte) : 0;
    const content = readFileSync(logFile).subarray(safeStart).toString('utf-8');
    return { lines: content.split('\n').filter(l => l.trim()), size };
  }
  const content = readFileSync(logFile, 'utf-8');
  return { lines: content.split('\n').filter(l => l.trim()).slice(startLine), size };
}

/**
 * Read TLDR session metrics for a workspace from log files.
 *
 * @param workspacePath - Workspace root (where .tldr/ lives)
 * @param sinceCheckpoint - Only return metrics since the last captured checkpoint
 */
export function getTldrMetricsSync(workspacePath: string, sinceCheckpoint = false): TldrSessionMetrics {
  const tldrDir = join(workspacePath, '.tldr');
  const interceptionsLog = join(tldrDir, 'interceptions.log');
  const bypassesLog = join(tldrDir, 'bypasses.log');
  const checkpointFile = join(tldrDir, 'metrics-checkpoint.json');

  const checkpoint = sinceCheckpoint ? readMetricsCheckpoint(checkpointFile) : null;
  const interceptionsStartByte = checkpoint?.interceptionsByte;
  const bypassesStartByte = checkpoint?.bypassesByte;
  const interceptionsStartLine = checkpoint?.interceptionsLine ?? 0;
  const bypassesStartLine = checkpoint?.bypassesLine ?? 0;

  // Parse interceptions log: each line is "timestamp file_size rel_path"
  const newInterceptions = readLogLines(
    interceptionsLog,
    sinceCheckpoint ? interceptionsStartByte : undefined,
    sinceCheckpoint && interceptionsStartByte === undefined ? interceptionsStartLine : 0,
  ).lines;

  let estimatedTokensSaved = 0;
  const filesAnalyzed: string[] = [];

  for (const line of newInterceptions) {
    const parts = line.trim().split(' ');
    if (parts.length >= 3) {
      const fileSizeBytes = parseInt(parts[1], 10) || 0;
      const relPath = parts.slice(2).join(' ');
      // Rough estimate: ~1 token per 4 bytes for code; TLDR summary is ~1000 tokens
      const fullTokens = Math.round(fileSizeBytes / 4);
      estimatedTokensSaved += Math.max(0, fullTokens - 1000);
      if (relPath && !filesAnalyzed.includes(relPath)) {
        filesAnalyzed.push(relPath);
      }
    }
  }

  // Parse bypasses log: each line is "timestamp reason [rel_path]"
  const newBypasses = readLogLines(
    bypassesLog,
    sinceCheckpoint ? bypassesStartByte : undefined,
    sinceCheckpoint && bypassesStartByte === undefined ? bypassesStartLine : 0,
  ).lines;
  const bypassReasons: Record<string, number> = {};

  for (const line of newBypasses) {
    const parts = line.trim().split(' ');
    if (parts.length >= 2) {
      const reason = parts[1];
      bypassReasons[reason] = (bypassReasons[reason] || 0) + 1;
    }
  }

  return {
    interceptions: newInterceptions.length,
    bypasses: newBypasses.length,
    estimatedTokensSaved,
    filesAnalyzed,
    bypassReasons,
  };
}

/**
 * Capture TLDR metrics since the last checkpoint and advance the checkpoint.
 *
 * Call this once per cost event batch to get the delta metrics for that batch,
 * then update the checkpoint so the next call starts from here.
 *
 * @param workspacePath - Workspace root (where .tldr/ lives)
 * @returns Metrics delta since last capture, or null if no .tldr/ directory exists
 */
export function captureTldrMetricsSync(workspacePath: string): TldrSessionMetrics | null {
  const tldrDir = join(workspacePath, '.tldr');
  if (!existsSync(tldrDir)) {
    return null;
  }

  const metrics = getTldrMetricsSync(workspacePath, true);

  // Advance checkpoint to current byte offsets without rescanning historical logs.
  const interceptionsLog = join(tldrDir, 'interceptions.log');
  const bypassesLog = join(tldrDir, 'bypasses.log');
  const checkpointFile = join(tldrDir, 'metrics-checkpoint.json');
  const previous = readMetricsCheckpoint(checkpointFile);
  const interceptionsByte = existsSync(interceptionsLog) ? statSync(interceptionsLog).size : 0;
  const bypassesByte = existsSync(bypassesLog) ? statSync(bypassesLog).size : 0;
  const previousInterceptionsLine = previous?.interceptionsByte !== undefined && previous.interceptionsByte > interceptionsByte
    ? 0
    : previous?.interceptionsLine ?? 0;
  const previousBypassesLine = previous?.bypassesByte !== undefined && previous.bypassesByte > bypassesByte
    ? 0
    : previous?.bypassesLine ?? 0;

  const checkpoint: TldrMetricsCheckpoint = {
    interceptionsLine: previousInterceptionsLine + metrics.interceptions,
    bypassesLine: previousBypassesLine + metrics.bypasses,
    interceptionsByte,
    bypassesByte,
    capturedAt: new Date().toISOString(),
  };

  try {
    writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf-8');
  } catch { /* non-fatal — metrics still returned */ }

  return metrics;
}

const execAsync = promisify(exec);

/**
 * TLDR daemon status
 */
export interface TldrDaemonStatus {
  running: boolean;
  pid?: number;
  startedAt?: Date;
  workspacePath: string;
  venvPath: string;
  healthy: boolean;
}

/**
 * Live daemon state derived from the tldr-owned pidfile.
 *
 * The `tldr` binary writes its PID to <workspace>/.tldr/daemon.pid on start
 * and removes it on stop. That file is the single source of truth — Panopticon
 * does not maintain its own state file (PAN-1132: writing our own state with a
 * fallback to the CLI's process.pid caused the file to be reaped the moment the
 * CLI exited, making running daemons report as stopped).
 */
interface LiveDaemonState {
  pid: number;
  startedAt?: Date;
}

/** Path to the tldr-owned pidfile for a workspace */
function getPidFilePath(workspacePath: string): string {
  return join(workspacePath, '.tldr', 'daemon.pid');
}

/**
 * Read the live daemon state for a workspace.
 *
 * Returns null when no pidfile exists or the process is gone.
 */
function readDaemonState(workspacePath: string): LiveDaemonState | null {
  const pidFile = getPidFilePath(workspacePath);
  if (!existsSync(pidFile)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(pidFile, 'utf-8').trim();
  } catch {
    return null;
  }

  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }

  try {
    process.kill(pid, 0);
  } catch {
    return null;
  }

  let startedAt: Date | undefined;
  try {
    startedAt = statSync(pidFile).mtime;
  } catch { /* informational only */ }

  return { pid, startedAt };
}

/**
 * TLDR Daemon Service
 *
 * Manages llm-tldr daemons for project root and workspaces.
 */
export class TldrDaemonService {
  private workspacePath: string;
  private venvPath: string;

  /**
   * Create a new TLDR daemon service for a workspace
   *
   * @param workspacePath - Path to the workspace (project root or workspace directory)
   * @param venvPath - Path to the Python venv containing llm-tldr
   */
  constructor(workspacePath: string, venvPath: string) {
    this.workspacePath = workspacePath;
    this.venvPath = venvPath;
  }

  /**
   * Start the TLDR daemon
   *
   * @param background - Run daemon in background (default: true)
   */
  async start(background = true): Promise<void> {
    const currentState = readDaemonState(this.workspacePath);
    if (currentState) {
      console.warn(`TLDR daemon already running for ${this.workspacePath} (PID: ${currentState.pid})`);
      return;
    }

    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      throw new Error(`tldr binary not found at ${tldrBin}. Ensure llm-tldr is installed in the venv.`);
    }

    console.log(`Starting TLDR daemon for ${this.workspacePath}...`);

    try {
      const cmd = background
        ? `cd "${this.workspacePath}" && "${tldrBin}" daemon start --project "${this.workspacePath}" >/dev/null 2>&1 &`
        : `cd "${this.workspacePath}" && "${tldrBin}" daemon start --project "${this.workspacePath}"`;

      const { stderr } = await execAsync(cmd);

      if (stderr && !stderr.includes('started')) {
        console.warn(`TLDR daemon start warning: ${stderr}`);
      }

      // Poll for the tldr-owned pidfile to appear with a live process.
      const deadline = Date.now() + 5000;
      let state: LiveDaemonState | null = null;
      while (Date.now() < deadline) {
        state = readDaemonState(this.workspacePath);
        if (state) break;
        await new Promise(r => setTimeout(r, 100));
      }

      if (!state) {
        throw new Error(`TLDR daemon failed to write pidfile at ${getPidFilePath(this.workspacePath)} within 5s`);
      }

      console.log(`✓ TLDR daemon started for ${this.workspacePath} (PID: ${state.pid})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start TLDR daemon: ${errorMessage}`);
    }
  }

  /**
   * Stop the TLDR daemon
   */
  async stop(): Promise<void> {
    const currentState = readDaemonState(this.workspacePath);
    if (!currentState) {
      console.warn(`TLDR daemon not running for ${this.workspacePath}`);
      return;
    }

    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      console.warn(`tldr binary not found at ${tldrBin}, killing daemon directly`);
      try { process.kill(currentState.pid, 'SIGTERM'); } catch { /* already gone */ }
      return;
    }

    console.log(`Stopping TLDR daemon for ${this.workspacePath}...`);

    try {
      await execAsync(`cd "${this.workspacePath}" && "${tldrBin}" daemon stop`);
      console.log(`✓ TLDR daemon stopped for ${this.workspacePath}`);
    } catch (error) {
      try {
        process.kill(currentState.pid, 'SIGTERM');
        console.log(`✓ Forcefully stopped TLDR daemon (PID: ${currentState.pid})`);
      } catch (killError) {
        console.warn(`Failed to kill TLDR daemon process: ${killError}`);
      }
    }
  }

  /**
   * Get daemon status
   */
  async getStatus(): Promise<TldrDaemonStatus> {
    const state = readDaemonState(this.workspacePath);

    if (!state) {
      return {
        running: false,
        workspacePath: this.workspacePath,
        venvPath: this.venvPath,
        healthy: false,
      };
    }

    const healthy = await this.checkHealth();

    return {
      running: true,
      pid: state.pid,
      startedAt: state.startedAt,
      workspacePath: this.workspacePath,
      venvPath: this.venvPath,
      healthy,
    };
  }

  /**
   * Check if daemon is healthy (can respond to status queries)
   */
  async checkHealth(): Promise<boolean> {
    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      return false;
    }

    try {
      // Try to get daemon status
      await execAsync(`cd "${this.workspacePath}" && "${tldrBin}" daemon status`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restart the daemon
   */
  async restart(): Promise<void> {
    console.log(`Restarting TLDR daemon for ${this.workspacePath}...`);
    await this.stop();
    await new Promise(r => setTimeout(r, 1000)); // Wait for cleanup
    await this.start();
  }

  /**
   * Warm the index (trigger initial analysis)
   *
   * @param background - Run in background (default: true)
   */
  async warm(background = true): Promise<void> {
    const tldrBin = join(this.venvPath, 'bin', 'tldr');
    if (!existsSync(tldrBin)) {
      throw new Error(`tldr binary not found at ${tldrBin}`);
    }

    console.log(`Warming TLDR index for ${this.workspacePath}...`);

    try {
      const cmd = background
        ? `cd "${this.workspacePath}" && "${tldrBin}" warm . >/dev/null 2>&1 &`
        : `cd "${this.workspacePath}" && "${tldrBin}" warm .`;

      await execAsync(cmd);
      console.log(`✓ TLDR index warming initiated for ${this.workspacePath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to warm TLDR index: ${errorMessage}`);
    }
  }

  /**
   * Check if daemon is running
   */
  isRunning(): boolean {
    return readDaemonState(this.workspacePath) !== null;
  }

  /**
   * Get workspace path
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Get venv path
   */
  getVenvPath(): string {
    return this.venvPath;
  }
}

/**
 * Global registry of TLDR daemon services by workspace path
 */
const daemonRegistry = new Map<string, TldrDaemonService>();

/**
 * Get or create a TLDR daemon service for a workspace
 *
 * @param workspacePath - Path to the workspace
 * @param venvPath - Path to the Python venv
 */
export function getTldrDaemonServiceSync(workspacePath: string, venvPath: string): TldrDaemonService {
  const existing = daemonRegistry.get(workspacePath);
  if (existing) {
    return existing;
  }

  const service = new TldrDaemonService(workspacePath, venvPath);
  daemonRegistry.set(workspacePath, service);
  return service;
}

/**
 * Remove a daemon service from the registry
 *
 * @param workspacePath - Path to the workspace
 */
export function removeTldrDaemonServiceSync(workspacePath: string): void {
  daemonRegistry.delete(workspacePath);
}

/**
 * List all registered daemon services
 */
export function listTldrDaemonServicesSync(): TldrDaemonService[] {
  return Array.from(daemonRegistry.values());
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Read per-session TLDR metrics from log files in a workspace. */
export const getTldrMetrics = (
  workspacePath: string,
  sinceCheckpoint = false,
): Effect.Effect<TldrSessionMetrics, FsError> =>
  Effect.try({
    try: () => getTldrMetricsSync(workspacePath, sinceCheckpoint),
    catch: (cause) =>
      new FsError({ path: workspacePath, operation: 'getTldrMetrics', cause }),
  });

/** Capture-and-checkpoint TLDR metrics; null when nothing new is logged. */
export const captureTldrMetrics = (
  workspacePath: string,
): Effect.Effect<TldrSessionMetrics | null, FsError> =>
  Effect.try({
    try: () => captureTldrMetricsSync(workspacePath),
    catch: (cause) =>
      new FsError({ path: workspacePath, operation: 'captureTldrMetrics', cause }),
  });

/** Get-or-create the registry entry for a workspace's TLDR daemon. */
export const getTldrDaemonService = (
  workspacePath: string,
  venvPath: string,
): Effect.Effect<TldrDaemonService> =>
  Effect.sync(() => getTldrDaemonServiceSync(workspacePath, venvPath));

/** Remove a daemon service from the registry. */
export const removeTldrDaemonService = (
  workspacePath: string,
): Effect.Effect<void> => Effect.sync(() => removeTldrDaemonServiceSync(workspacePath));

/** Snapshot every registered daemon service. */
export const listTldrDaemonServices = (): Effect.Effect<readonly TldrDaemonService[]> =>
  Effect.sync(() => listTldrDaemonServicesSync());
