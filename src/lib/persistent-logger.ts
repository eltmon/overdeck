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
import { join } from 'path';
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
export function logDeaconEvent(message: string): void {
  ensureLogsDir();
  try {
    appendFileSync(join(LOGS_DIR, 'deacon.log'), `[${timestamp()}] ${message}\n`);
  } catch {
    // Non-fatal — logging must never break recovery logic
  }
}

/** Append a line to ~/.panopticon/agents/<agentId>/lifecycle.log */
export function logAgentLifecycle(agentId: string, message: string): void {
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
