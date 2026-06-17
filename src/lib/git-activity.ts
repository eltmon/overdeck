/**
 * Git Activity Service (PAN-653)
 *
 * Write path and read path for git operation events persisted to the
 * git_operations SQLite table. Survives dashboard restart — unlike the
 * in-memory activityLog array which is capped at 100 and wiped on restart.
 *
 * All functions use the async-safe getDatabase() which runs under Node 22.
 * NEVER use execSync/readFileSync here — this runs in the dashboard server.
 */

import { Effect, Data } from 'effect';
import {
  appendGitOperationSync,
  listGitOperationsSync,
} from './database/git-operations-db.js';
import type {
  GitOperation,
  GitOperationFilter,
  GitOperationType,
  GitOperationStatus,
} from './database/git-operations-db.js';

export type { GitOperation, GitOperationFilter, GitOperationType, GitOperationStatus };
export { appendGitOperationSync, listGitOperationsSync };

/** A database operation against the git_operations table failed. */
export class GitActivityDbError extends Data.TaggedError('GitActivityDbError')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect-native appendGitOperation — typed-error variant of the SQLite write.
 * Fails with GitActivityDbError if the insert throws (e.g. DB locked).
 */
export const appendGitOperation = (
  op: Omit<GitOperation, 'id'>,
): Effect.Effect<number, GitActivityDbError> =>
  Effect.try({
    try: () => appendGitOperationSync(op),
    catch: (cause) => new GitActivityDbError({ operation: 'appendGitOperation', cause }),
  });

/**
 * Effect-native listGitOperations — typed-error variant of the SQLite read.
 * Fails with GitActivityDbError on query failure.
 */
export const listGitOperations = (
  filter: GitOperationFilter = {},
): Effect.Effect<readonly GitOperation[], GitActivityDbError> =>
  Effect.try({
    try: () => listGitOperationsSync(filter),
    catch: (cause) => new GitActivityDbError({ operation: 'listGitOperations', cause }),
  });
