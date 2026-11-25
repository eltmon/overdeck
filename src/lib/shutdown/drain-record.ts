/**
 * The shutdown record (PAN-5342, D-1).
 *
 * `<OVERDECK_HOME>/shutdown.json` is the only stored shutdown state. While it
 * exists Overdeck is draining: every launch door refuses (D-2), the pre-tool
 * hook denies new tool calls (D-3), and Deacon patrols stand still. The record
 * also lists every session the drain stopped, which seeds the resume offer
 * (D-9, D-10). It has no expiry: the next dashboard boot consumes a leftover
 * record.
 *
 * Leaf module: imports only node built-ins, `../paths.js` and the flywheel
 * constants, so the CLI, the dashboard and the deacon child can all stat it
 * cheaply.
 */
import { existsSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FLYWHEEL_CONVERSATION_SESSION } from '../flywheel/constants.js';
import { getOverdeckHome } from '../paths.js';

export type ShutdownPhase = 'draining' | 'waiting-for-writers' | 'verifying' | 'complete';

export interface ShutdownStoppedSession {
  kind: 'agent' | 'conversation';
  id: string;
  name?: string;
  issueId?: string;
  label: string;
  wasWorking: boolean;
}

/**
 * Whether the resume offer lists a session the drain stopped (D-9): every
 * agent, the conversations that were mid-turn when the drain first saw them,
 * and the Flywheel conversation even when it was idle between ticks
 * (PAN-5671). The loop waits for its next tick almost all of the time, so a
 * `wasWorking` rule alone would almost never offer it. It is offered, never
 * resumed on its own.
 */
export function isOfferedAfterShutdown(session: ShutdownStoppedSession): boolean {
  return session.kind === 'agent' || session.wasWorking || session.id === FLYWHEEL_CONVERSATION_SESSION;
}

export interface ShutdownRecord {
  version: 1;
  startedAt: string;
  deadlineAt: string;
  reboot: boolean;
  force: 'never' | 'at-deadline' | 'now';
  phase: ShutdownPhase;
  stopped: ShutdownStoppedSession[];
}

export function shutdownRecordPath(): string {
  return join(getOverdeckHome(), 'shutdown.json');
}

export function isShutdownDrainingSync(): boolean {
  return existsSync(shutdownRecordPath());
}

/** The record, or null when it is missing or not valid JSON. */
export async function readShutdownRecord(): Promise<ShutdownRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(shutdownRecordPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as ShutdownRecord) : null;
  } catch {
    return null;
  }
}

/** Write atomically: a per-process temp file, then rename over the record. */
export async function writeShutdownRecord(record: ShutdownRecord): Promise<void> {
  const path = shutdownRecordPath();
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

export async function deleteShutdownRecord(): Promise<void> {
  try {
    await unlink(shutdownRecordPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export const SHUTDOWN_REFUSAL =
  'Overdeck is shutting down (pan shutdown). New work is refused. Cancel with `pan shutdown --cancel`, or run `pan up` after the restart.';

export class ShutdownDrainingError extends Error {
  readonly code = 'shutdown-draining' as const;
}

export function assertNotShuttingDown(): void {
  if (isShutdownDrainingSync()) throw new ShutdownDrainingError(SHUTDOWN_REFUSAL);
}
