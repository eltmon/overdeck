/**
 * Persist the dashboard server's console output to
 * `<PANOPTICON_HOME>/logs/dashboard.log` regardless of how the server was
 * launched (PAN-1552).
 *
 * Detached launchers (`pan up --detach`, `pan restart`) redirect the child's
 * stdout/stderr straight to the log file at the OS level. But `serve` (the
 * `npx @panctl/cli` entrypoint) and the desktop app inherit a terminal/pipe,
 * so without this the only record of an error — e.g. the cause behind a
 * conversation-message 500 — lives in a foreground terminal and is lost the
 * moment that process exits.
 *
 * This module tees `process.stdout`/`process.stderr` to the log file so the
 * record survives in every launch mode, while still writing to the original
 * destination so foreground/terminal output is unchanged.
 */

import { createWriteStream, fstatSync, statSync, mkdirSync, type WriteStream } from 'fs';
import { join } from 'path';
import { getPanopticonHome } from '../../lib/paths.js';

let installed = false;

/** Absolute path the dashboard server persists its console output to. */
export function dashboardLogPath(): string {
  return join(getPanopticonHome(), 'logs', 'dashboard.log');
}

/**
 * True when the process's stdout already *is* the dashboard.log file — i.e. a
 * detached launcher redirected the child's stdout/stderr straight to it. In
 * that case teeing again would double-write every line, so the server leaves
 * logging to the inherited fd. Returns false on any error (e.g. the file does
 * not exist yet), which is the safe default — tee and create it.
 */
export function stdoutAlreadyTargetsLog(logPath: string): boolean {
  try {
    const out = fstatSync(1);
    const file = statSync(logPath);
    return out.dev === file.dev && out.ino === file.ino;
  } catch {
    return false;
  }
}

/**
 * Wrap a writable stream so every write is also appended to `file`, best-effort.
 * The original write's return value (backpressure signal) and callback are
 * preserved so the real terminal/pipe behaves exactly as before. A failure to
 * write the log copy never breaks the real stream.
 */
export function teeStreamToFile(
  target: Pick<NodeJS.WriteStream, 'write'>,
  file: WriteStream,
): void {
  const original = target.write.bind(target) as NodeJS.WriteStream['write'];
  target.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    try {
      file.write(chunk as string | Uint8Array);
    } catch {
      // Logging is best-effort — never let a log-file write break stdout/stderr.
    }
    return (original as (...args: unknown[]) => boolean)(chunk, encoding, cb);
  }) as NodeJS.WriteStream['write'];
}

/**
 * Mirror the dashboard server's stdout/stderr to the dashboard log file.
 * Idempotent — safe to call once at startup; subsequent calls are no-ops.
 */
export function initDashboardLogFile(): void {
  if (installed) return;
  installed = true;
  try {
    const logPath = dashboardLogPath();
    if (stdoutAlreadyTargetsLog(logPath)) return;
    mkdirSync(join(getPanopticonHome(), 'logs'), { recursive: true });
    const stream = createWriteStream(logPath, { flags: 'a' });
    // A regular-file append stream should not emit 'error' in normal operation,
    // but attach a handler so an unexpected failure can't crash the process via
    // an unhandled 'error' event.
    stream.on('error', () => { /* best-effort logging only */ });
    teeStreamToFile(process.stdout, stream);
    teeStreamToFile(process.stderr, stream);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      process.stderr.write(`[dashboard] could not initialize log file: ${msg}\n`);
    } catch {
      // nothing more we can do
    }
  }
}
