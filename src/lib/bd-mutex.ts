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
