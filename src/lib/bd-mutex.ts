/**
 * Global mutex for bd (beads) CLI commands.
 *
 * Embedded Dolt uses file-based locking — only one process can hold the
 * database lock at a time. When the dashboard spawns concurrent `bd` commands
 * (e.g. planning-state queries for every kanban card), each process blocks
 * waiting for the lock, creating a cascade of hundreds of hung processes.
 *
 * This mutex serializes all bd operations so only one runs at a time,
 * preventing lock contention and process pile-up.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let pending: Promise<void> = Promise.resolve();

/**
 * Run a bd command exclusively — waits for any in-flight bd operation to
 * finish before starting, and blocks subsequent operations until this one
 * completes.
 *
 * @param fn - Async function that runs a bd command
 * @returns The result of fn
 */
export async function withBdMutex<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the previous promise — this serializes all callers
  const result = pending.then(fn, fn);
  // Update pending to track this operation's completion (success or failure)
  pending = result.then(() => {}, () => {});
  return result;
}

export async function restoreTrackedBeadsExport(workspacePath: string): Promise<void> {
  try {
    const { stdout } = await execAsync('git status --porcelain -- .beads/issues.jsonl', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    if (stdout.split('\n').some((line) => line.slice(0, 2).includes('D'))) {
      await execAsync('git restore -- .beads/issues.jsonl', { cwd: workspacePath });
    }
  } catch {}
}

export async function withWorkspaceBdMutex<T>(workspacePath: string, fn: () => Promise<T>): Promise<T> {
  return withBdMutex(async () => {
    try {
      return await fn();
    } finally {
      await restoreTrackedBeadsExport(workspacePath);
    }
  });
}
