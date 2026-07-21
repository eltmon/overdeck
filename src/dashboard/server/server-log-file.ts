/**
 * Persist the dashboard server's console output to
 * `<OVERDECK_HOME>/logs/dashboard.log` regardless of how the server was
 * launched (PAN-1552).
 *
 * Detached launchers (`pan up --detach`, `pan restart`) redirect the child's
 * stdout/stderr straight to the log file at the OS level. But `serve` (the
 * `npx @overdeck/core` entrypoint) and the desktop app inherit a terminal/pipe,
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
import { getOverdeckHome } from '../../lib/paths.js';

let installed = false;

/** Absolute path the dashboard server persists its console output to. */
export function dashboardLogPath(): string {
  return join(getOverdeckHome(), 'logs', 'dashboard.log');
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
/** True when `chunk` (string or bytes) ends in a newline. */
function endsWithNewline(chunk: unknown): boolean {
  if (typeof chunk === 'string') return chunk.endsWith('\n');
  if (chunk instanceof Uint8Array) return chunk.length > 0 && chunk[chunk.length - 1] === 0x0a;
  return false;
}

export function teeStreamToFile(
  target: Pick<NodeJS.WriteStream, 'write'>,
  file: WriteStream,
): void {
  const original = target.write.bind(target) as NodeJS.WriteStream['write'];
  // Prefix each line in the FILE copy with an ISO timestamp so the log is
  // self-diagnosing — boot phases, the gap before "Listening", and the cost of
  // any slow handler are all attributable from the file alone. The terminal
  // copy (the `original` write below) is left untouched, so foreground output
  // is unchanged. Stamping only at line starts keeps mid-line writes intact and
  // costs one `Date` per logged line.
  let atLineStart = true;
  target.write = ((chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
    try {
      if (atLineStart) file.write(`[${new Date().toISOString()}] `);
      file.write(chunk as string | Uint8Array);
      atLineStart = endsWithNewline(chunk);
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
    mkdirSync(join(getOverdeckHome(), 'logs'), { recursive: true });
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
