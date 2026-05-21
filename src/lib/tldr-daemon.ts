/**
 * TLDR Daemon Service
 *
 * Manages llm-tldr daemon lifecycle for project root and workspaces.
 * Provides code analysis and summarization for token-efficient agent work.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Data, Effect } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';

// ============================================================================
// Typed errors
// ============================================================================

/** tldr binary not found in the venv. */
export class TldrNotInstalledError extends Data.TaggedError('TldrNotInstalledError')<{
  readonly venvPath: string;
  readonly tldrBin: string;
}> {}

/** Daemon failed to write its pidfile within the startup deadline. */
export class TldrStartError extends Data.TaggedError('TldrStartError')<{
  readonly workspacePath: string;
  readonly message?: string;
}> {}

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
  interceptions: number;
  bypasses: number;
  estimatedTokensSaved: number;
  filesAnalyzed: string[];
  bypassReasons: Record<string, number>;
}

/** Checkpoint persisted to .tldr/metrics-checkpoint.json */
interface TldrMetricsCheckpoint {
  interceptionsLine?: number;
  bypassesLine?: number;
  interceptionsByte?: number;
  bypassesByte?: number;
  capturedAt: string;
}

// ─── Internal helpers (sync FS wrapped in Effect.try) ─────────────────────────

function readMetricsCheckpointEffect(checkpointFile: string): Effect.Effect<TldrMetricsCheckpoint | null> {
  if (!existsSync(checkpointFile)) return Effect.succeed(null);
  return Effect.try({
    try: () => JSON.parse(readFileSync(checkpointFile, 'utf-8')) as TldrMetricsCheckpoint,
    catch: () => null as TldrMetricsCheckpoint | null,
  }).pipe(Effect.catch(() => Effect.succeed<TldrMetricsCheckpoint | null>(null)));
}

function readLogLinesEffect(
  logFile: string,
  startByte?: number,
  startLine = 0,
): Effect.Effect<{ lines: string[]; size: number }> {
  if (!existsSync(logFile)) return Effect.succeed({ lines: [], size: 0 });
  return Effect.try({
    try: () => {
      const size = statSync(logFile).size;
      if (startByte !== undefined) {
        const safeStart = startByte <= size ? Math.max(0, startByte) : 0;
        const content = readFileSync(logFile).subarray(safeStart).toString('utf-8');
        return { lines: content.split('\n').filter(l => l.trim()), size };
      }
      const content = readFileSync(logFile, 'utf-8');
      return { lines: content.split('\n').filter(l => l.trim()).slice(startLine), size };
    },
    catch: () => ({ lines: [], size: 0 }),
  }).pipe(Effect.catch(() => Effect.succeed({ lines: [], size: 0 })));
}

/**
 * Read TLDR session metrics for a workspace from log files.
 *
 * @param workspacePath - Workspace root (where .tldr/ lives)
 * @param sinceCheckpoint - Only return metrics since the last captured checkpoint
 */
export function getTldrMetrics(workspacePath: string, sinceCheckpoint = false): Effect.Effect<TldrSessionMetrics> {
  return Effect.gen(function* () {
    const tldrDir = join(workspacePath, '.tldr');
    const interceptionsLog = join(tldrDir, 'interceptions.log');
    const bypassesLog = join(tldrDir, 'bypasses.log');
    const checkpointFile = join(tldrDir, 'metrics-checkpoint.json');

    const checkpoint = sinceCheckpoint ? yield* readMetricsCheckpointEffect(checkpointFile) : null;
    const interceptionsStartByte = checkpoint?.interceptionsByte;
    const bypassesStartByte = checkpoint?.bypassesByte;
    const interceptionsStartLine = checkpoint?.interceptionsLine ?? 0;
    const bypassesStartLine = checkpoint?.bypassesLine ?? 0;

    const { lines: newInterceptions } = yield* readLogLinesEffect(
      interceptionsLog,
      sinceCheckpoint ? interceptionsStartByte : undefined,
      sinceCheckpoint && interceptionsStartByte === undefined ? interceptionsStartLine : 0,
    );

    let estimatedTokensSaved = 0;
    const filesAnalyzed: string[] = [];

    for (const line of newInterceptions) {
      const parts = line.trim().split(' ');
      if (parts.length >= 3) {
        const fileSizeBytes = parseInt(parts[1], 10) || 0;
        const relPath = parts.slice(2).join(' ');
        const fullTokens = Math.round(fileSizeBytes / 4);
        estimatedTokensSaved += Math.max(0, fullTokens - 1000);
        if (relPath && !filesAnalyzed.includes(relPath)) {
          filesAnalyzed.push(relPath);
        }
      }
    }

    const { lines: newBypasses } = yield* readLogLinesEffect(
      bypassesLog,
      sinceCheckpoint ? bypassesStartByte : undefined,
      sinceCheckpoint && bypassesStartByte === undefined ? bypassesStartLine : 0,
    );
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
  });
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
export function captureTldrMetrics(workspacePath: string): Effect.Effect<TldrSessionMetrics | null> {
  const tldrDir = join(workspacePath, '.tldr');
  if (!existsSync(tldrDir)) {
    return Effect.succeed(null);
  }

  return Effect.gen(function* () {
    const metrics = yield* getTldrMetrics(workspacePath, true);

    const interceptionsLog = join(tldrDir, 'interceptions.log');
    const bypassesLog = join(tldrDir, 'bypasses.log');
    const checkpointFile = join(tldrDir, 'metrics-checkpoint.json');

    const previous = yield* readMetricsCheckpointEffect(checkpointFile);

    const interceptionsByte = existsSync(interceptionsLog)
      ? yield* Effect.try({ try: () => statSync(interceptionsLog).size, catch: () => 0 })
          .pipe(Effect.catch(n => Effect.succeed(n)))
      : 0;
    const bypassesByte = existsSync(bypassesLog)
      ? yield* Effect.try({ try: () => statSync(bypassesLog).size, catch: () => 0 })
          .pipe(Effect.catch(n => Effect.succeed(n)))
      : 0;

    const previousInterceptionsLine =
      previous?.interceptionsByte !== undefined && previous.interceptionsByte > interceptionsByte
        ? 0
        : previous?.interceptionsLine ?? 0;
    const previousBypassesLine =
      previous?.bypassesByte !== undefined && previous.bypassesByte > bypassesByte
        ? 0
        : previous?.bypassesLine ?? 0;

    const checkpoint: TldrMetricsCheckpoint = {
      interceptionsLine: previousInterceptionsLine + metrics.interceptions,
      bypassesLine: previousBypassesLine + metrics.bypasses,
      interceptionsByte,
      bypassesByte,
      capturedAt: new Date().toISOString(),
    };

    yield* Effect.try({
      try: () => writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf-8'),
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.void));

    return metrics;
  });
}

// ============================================================================
// Daemon status / pidfile
// ============================================================================

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
 * does not maintain its own state file (PAN-1132).
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
function readDaemonStateEffect(workspacePath: string): Effect.Effect<LiveDaemonState | null> {
  const pidFile = getPidFilePath(workspacePath);
  if (!existsSync(pidFile)) return Effect.succeed(null);

  return Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => readFileSync(pidFile, 'utf-8').trim(),
      catch: () => '',
    }).pipe(Effect.catch(e => Effect.succeed(e)));

    const pid = parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null as LiveDaemonState | null;

    const alive = yield* Effect.try({
      try: () => { process.kill(pid, 0); return true; },
      catch: () => false,
    }).pipe(Effect.catch(e => Effect.succeed(e)));
    if (!alive) return null as LiveDaemonState | null;

    const startedAt = yield* Effect.try({
      try: () => statSync(pidFile).mtime,
      catch: () => undefined as Date | undefined,
    }).pipe(Effect.catch(e => Effect.succeed(e)));

    return { pid, startedAt } as LiveDaemonState;
  });
}

// ============================================================================
// TldrDaemonService
// ============================================================================

/**
 * TLDR Daemon Service
 *
 * Manages llm-tldr daemons for project root and workspaces.
 */
export class TldrDaemonService {
  private workspacePath: string;
  private venvPath: string;

  constructor(workspacePath: string, venvPath: string) {
    this.workspacePath = workspacePath;
    this.venvPath = venvPath;
  }

  /**
   * Start the TLDR daemon.
   *
   * @param background - Run daemon in background (default: true)
   */
  start(background = true): Effect.Effect<void, TldrNotInstalledError | TldrStartError, ChildProcessSpawner> {
    const workspacePath = this.workspacePath;
    const venvPath = this.venvPath;
    return Effect.gen(function* () {
      const currentState = yield* readDaemonStateEffect(workspacePath);
      if (currentState !== null) {
        return; // already running
      }

      const tldrBin = join(venvPath, 'bin', 'tldr');
      if (!existsSync(tldrBin)) {
        return yield* Effect.fail(new TldrNotInstalledError({ venvPath, tldrBin }));
      }

      const cmd = background
        ? `"${tldrBin}" daemon start --project "${workspacePath}" >/dev/null 2>&1 &`
        : `"${tldrBin}" daemon start --project "${workspacePath}"`;

      const spawner = yield* ChildProcessSpawner;
      yield* spawner.exitCode(
        ChildProcess.make('sh', ['-c', cmd], { cwd: workspacePath }),
      ).pipe(
        Effect.mapError(
          (e) => new TldrStartError({ workspacePath, message: String(e) }),
        ),
      );

      // Poll for the tldr-owned pidfile (both background and foreground paths).
      let state: LiveDaemonState | null = null;
      for (let i = 0; i < 50; i++) {
        state = yield* readDaemonStateEffect(workspacePath);
        if (state !== null) break;
        yield* Effect.sleep('100 millis');
      }

      if (state === null) {
        return yield* Effect.fail(
          new TldrStartError({
            workspacePath,
            message: `pidfile not written within 5s at ${getPidFilePath(workspacePath)}`,
          }),
        );
      }
    });
  }

  /**
   * Stop the TLDR daemon.
   */
  stop(): Effect.Effect<void, never, ChildProcessSpawner> {
    const workspacePath = this.workspacePath;
    const venvPath = this.venvPath;
    return Effect.gen(function* () {
      const currentState = yield* readDaemonStateEffect(workspacePath);
      if (currentState === null) {
        return; // not running
      }

      const tldrBin = join(venvPath, 'bin', 'tldr');
      if (!existsSync(tldrBin)) {
        yield* Effect.try({
          try: () => { process.kill(currentState.pid, 'SIGTERM'); },
          catch: () => undefined,
        }).pipe(Effect.catch(() => Effect.void));
        return;
      }

      const spawner = yield* ChildProcessSpawner;
      const stopped = yield* spawner.exitCode(
        ChildProcess.make(tldrBin, ['daemon', 'stop'], { cwd: workspacePath }),
      ).pipe(
        Effect.map(code => Number(code) === 0),
        Effect.catch(() => Effect.succeed(false)),
      );

      if (!stopped) {
        yield* Effect.try({
          try: () => { process.kill(currentState.pid, 'SIGTERM'); },
          catch: () => undefined,
        }).pipe(Effect.catch(() => Effect.void));
      }
    });
  }

  /**
   * Get daemon status.
   */
  getStatus(): Effect.Effect<TldrDaemonStatus, never, ChildProcessSpawner> {
    const workspacePath = this.workspacePath;
    const venvPath = this.venvPath;
    return Effect.gen(function* () {
      const state = yield* readDaemonStateEffect(workspacePath);

      if (state === null) {
        return { running: false, workspacePath, venvPath, healthy: false };
      }

      const svc = new TldrDaemonService(workspacePath, venvPath);
      const healthy = yield* svc.checkHealth();

      return {
        running: true,
        pid: state.pid,
        startedAt: state.startedAt,
        workspacePath,
        venvPath,
        healthy,
      };
    });
  }

  /**
   * Check if daemon is healthy (can respond to status queries).
   */
  checkHealth(): Effect.Effect<boolean, never, ChildProcessSpawner> {
    const workspacePath = this.workspacePath;
    const venvPath = this.venvPath;
    return Effect.gen(function* () {
      const tldrBin = join(venvPath, 'bin', 'tldr');
      if (!existsSync(tldrBin)) return false;

      const spawner = yield* ChildProcessSpawner;
      return yield* spawner.exitCode(
        ChildProcess.make(tldrBin, ['daemon', 'status'], { cwd: workspacePath }),
      ).pipe(
        Effect.map(code => Number(code) === 0),
        Effect.timeout('3 seconds'),
        Effect.catchTag('TimeoutError', () => Effect.succeed(false)),
        Effect.catch(() => Effect.succeed(false)),
      );
    });
  }

  /**
   * Restart the daemon.
   */
  restart(): Effect.Effect<void, TldrNotInstalledError | TldrStartError, ChildProcessSpawner> {
    const workspacePath = this.workspacePath;
    const venvPath = this.venvPath;
    const svc = new TldrDaemonService(workspacePath, venvPath);
    return Effect.gen(function* () {
      yield* svc.stop();
      yield* Effect.sleep('1 second');
      yield* svc.start();
    });
  }

  /**
   * Warm the index (trigger initial analysis).
   *
   * @param background - Run in background (default: true)
   */
  warm(background = true): Effect.Effect<void, TldrNotInstalledError, ChildProcessSpawner> {
    const workspacePath = this.workspacePath;
    const venvPath = this.venvPath;
    return Effect.gen(function* () {
      const tldrBin = join(venvPath, 'bin', 'tldr');
      if (!existsSync(tldrBin)) {
        return yield* Effect.fail(new TldrNotInstalledError({ venvPath, tldrBin }));
      }

      const cmd = background
        ? `"${tldrBin}" warm . >/dev/null 2>&1 &`
        : `"${tldrBin}" warm .`;

      const spawner = yield* ChildProcessSpawner;
      yield* spawner.exitCode(
        ChildProcess.make('sh', ['-c', cmd], { cwd: workspacePath }),
      ).pipe(
        Effect.mapError(() => new TldrNotInstalledError({ venvPath, tldrBin })),
        Effect.flatMap(code =>
          !background && Number(code) !== 0
            ? Effect.fail(new TldrNotInstalledError({ venvPath, tldrBin }))
            : Effect.void,
        ),
      );
    });
  }

  /**
   * Check if daemon is running (sync pidfile check).
   */
  isRunning(): Effect.Effect<boolean> {
    return readDaemonStateEffect(this.workspacePath).pipe(
      Effect.map(state => state !== null),
    );
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  getVenvPath(): string {
    return this.venvPath;
  }
}

// ============================================================================
// Registry
// ============================================================================

/** Global registry of TLDR daemon services by workspace path */
const daemonRegistry = new Map<string, TldrDaemonService>();

/**
 * Get or create a TLDR daemon service for a workspace.
 */
export function getTldrDaemonService(workspacePath: string, venvPath: string): TldrDaemonService {
  const existing = daemonRegistry.get(workspacePath);
  if (existing) return existing;
  const service = new TldrDaemonService(workspacePath, venvPath);
  daemonRegistry.set(workspacePath, service);
  return service;
}

/**
 * Remove a daemon service from the registry.
 */
export function removeTldrDaemonService(workspacePath: string): void {
  daemonRegistry.delete(workspacePath);
}

/**
 * List all registered daemon services.
 */
export function listTldrDaemonServices(): TldrDaemonService[] {
  return Array.from(daemonRegistry.values());
}
