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

import { Effect } from 'effect';

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

// PAN-1158 superseded the inline copy of restoreTrackedBeadsExport with the
// shared helper in beads-restore.ts (HEAD-source restore covers staged
// deletions too). Re-export so call sites that imported from bd-mutex keep
// working.
export { restoreTrackedBeadsExport } from './beads-restore.js';

import { restoreTrackedBeadsExport as restoreBeads } from './beads-restore.js';

export async function withWorkspaceBdMutex<T>(workspacePath: string, fn: () => Promise<T>): Promise<T> {
  return withBdMutex(async () => {
    try {
      return await fn();
    } finally {
      await restoreBeads(workspacePath);
    }
  });
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native variant of withBdMutex over a thunk that returns a no-context
 * Effect. Serializes against all other bd-mutex callers via the Promise queue.
 * The wrapped Effect must be no-context (R = never) since it is launched from
 * inside a tryPromise — Layers cannot be threaded through the global mutex.
 */
export const withBdMutexEffect = <A, E>(
  fn: () => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: () => withBdMutex(() => Effect.runPromise(fn())),
    catch: (e) => e as E,
  });

/**
 * Effect-native variant of withWorkspaceBdMutex. Same context constraint as
 * withBdMutexEffect.
 */
export const withWorkspaceBdMutexEffect = <A, E>(
  workspacePath: string,
  fn: () => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: () => withWorkspaceBdMutex(workspacePath, () => Effect.runPromise(fn())),
    catch: (e) => e as E,
  });
