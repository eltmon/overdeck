/**
 * Append-only persistent logger for forensic audit trails.
 *
 * Complements the SQLite event store (activity-logger.ts) with flat-file logs
 * that survive event-store resets and are greppable from the shell.
 *
 * Files:
 *   ~/.overdeck/logs/deacon.log        — deacon startup recovery actions
 *   ~/.overdeck/agents/<id>/lifecycle.log — per-agent state transitions
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getOverdeckHome } from './paths.js';

function logsDir(): string {
  return join(getOverdeckHome(), 'logs');
}

function agentDir(agentId: string): string {
  return join(getOverdeckHome(), 'agents', agentId);
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

/** Append a line to ~/.overdeck/logs/deacon.log */
export function logDeaconEvent(message: string): void {
  ensureLogsDir();
  try {
    appendFileSync(join(logsDir(), 'deacon.log'), `[${timestamp()}] ${message}\n`);
  } catch {
    // Non-fatal — logging must never break recovery logic
  }
}

/** Append a line to ~/.overdeck/agents/<agentId>/lifecycle.log */
export function logAgentLifecycle(agentId: string, message: string): void {
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
