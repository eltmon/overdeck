/**
 * Append-only persistent logger for forensic audit trails.
 *
 * Complements the SQLite event store (activity-logger.ts) with flat-file logs
 * that survive event-store resets and are greppable from the shell.
 *
 * Files:
 *   ~/.panopticon/logs/deacon.log        — deacon startup recovery actions
 *   ~/.panopticon/agents/<id>/lifecycle.log — per-agent state transitions
 */

import { appendFileSync, mkdirSync } from 'fs';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { LOGS_DIR, AGENTS_DIR } from './paths.js';

function ensureLogsDir(): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
  } catch { /* non-fatal */ }
}

function ensureAgentDir(agentId: string): void {
  try {
    mkdirSync(join(AGENTS_DIR, agentId), { recursive: true });
  } catch { /* non-fatal */ }
}

function timestamp(): string {
  return new Date().toISOString();
}

/** Append a line to ~/.panopticon/logs/deacon.log */
export function logDeaconEventSync(message: string): void {
  ensureLogsDir();
  try {
    appendFileSync(join(LOGS_DIR, 'deacon.log'), `[${timestamp()}] ${message}\n`);
  } catch {
    // Non-fatal — logging must never break recovery logic
  }
}

/** Append a line to ~/.panopticon/agents/<agentId>/lifecycle.log */
export function logAgentLifecycleSync(agentId: string, message: string): void {
  ensureAgentDir(agentId);
  try {
    appendFileSync(
      join(AGENTS_DIR, agentId, 'lifecycle.log'),
      `[${timestamp()}] ${message}\n`,
    );
  } catch {
    // Non-fatal
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Logging must NEVER break recovery logic, so both Effect variants swallow all
// errors and return Effect<void, never> — they never fail the parent Effect.

/** Effect variant of {@link logDeaconEventSync}. Failures are swallowed silently. */
export const logDeaconEvent = (message: string): Effect.Effect<void, never> =>
  Effect.promise(async () => {
    try {
      await mkdir(LOGS_DIR, { recursive: true });
      await appendFile(join(LOGS_DIR, 'deacon.log'), `[${timestamp()}] ${message}\n`);
    } catch {
      // Non-fatal
    }
  });

/** Effect variant of {@link logAgentLifecycleSync}. Failures are swallowed silently. */
export const logAgentLifecycle = (agentId: string, message: string): Effect.Effect<void, never> =>
  Effect.promise(async () => {
    try {
      await mkdir(join(AGENTS_DIR, agentId), { recursive: true });
      await appendFile(
        join(AGENTS_DIR, agentId, 'lifecycle.log'),
        `[${timestamp()}] ${message}\n`,
      );
    } catch {
      // Non-fatal
    }
  });
