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
import { getPanopticonHome } from './paths.js';

function logsDir(): string {
  return join(getPanopticonHome(), 'logs');
}

function agentDir(agentId: string): string {
  return join(getPanopticonHome(), 'agents', agentId);
}

function ensureLogsDir(): void {
  try {
    mkdirSync(logsDir(), { recursive: true });
  } catch { /* non-fatal */ }
}

function ensureAgentDir(agentId: string): void {
  try {
    mkdirSync(agentDir(agentId), { recursive: true });
  } catch { /* non-fatal */ }
}

function timestamp(): string {
  return new Date().toISOString();
}

/** Append a line to ~/.panopticon/logs/deacon.log */
export function logDeaconEventSync(message: string): void {
  ensureLogsDir();
  try {
    appendFileSync(join(logsDir(), 'deacon.log'), `[${timestamp()}] ${message}\n`);
  } catch {
    // Non-fatal — logging must never break recovery logic
  }
}

/** Append a line to ~/.panopticon/agents/<agentId>/lifecycle.log */
export function logAgentLifecycleSync(agentId: string, message: string): void {
  ensureAgentDir(agentId);
  try {
    appendFileSync(
      join(agentDir(agentId), 'lifecycle.log'),
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
      const dir = logsDir();
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'deacon.log'), `[${timestamp()}] ${message}\n`);
    } catch {
      // Non-fatal
    }
  });

/** Effect variant of {@link logAgentLifecycleSync}. Failures are swallowed silently. */
export const logAgentLifecycle = (agentId: string, message: string): Effect.Effect<void, never> =>
  Effect.promise(async () => {
    try {
      const dir = agentDir(agentId);
      await mkdir(dir, { recursive: true });
      await appendFile(
        join(dir, 'lifecycle.log'),
        `[${timestamp()}] ${message}\n`,
      );
    } catch {
      // Non-fatal
    }
  });
