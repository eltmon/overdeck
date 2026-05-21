/**
 * Shared typed errors for src/lib Effect migration (PAN-1249, wave 0).
 *
 * All errors are `Data.TaggedError` subclasses so they participate in typed
 * Effect error channels and can be narrowed with `Effect.catchTag`.
 */

import { Data } from 'effect';

// ─── VCS errors ───────────────────────────────────────────────────────────────

/** A version-control operation (commit, push, pull, fetch) failed. */
export class VcsError extends Data.TaggedError('VcsError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A version-control operation exceeded its timeout. */
export class VcsTimeoutError extends Data.TaggedError('VcsTimeoutError')<{
  readonly operation: string;
  readonly timeoutMs: number;
}> {}

// ─── Filesystem errors ────────────────────────────────────────────────────────

/** A filesystem operation (read, write, mkdir, unlink, stat) failed. */
export class FsError extends Data.TaggedError('FsError')<{
  readonly path: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {}

/** The requested path does not exist. */
export class FsNotFoundError extends Data.TaggedError('FsNotFoundError')<{
  readonly path: string;
}> {}

// ─── Git errors ───────────────────────────────────────────────────────────────

/** A git command exited with a non-zero code. */
export class GitError extends Data.TaggedError('GitError')<{
  readonly command: readonly string[];
  readonly stderr: string;
  readonly exitCode: number;
  readonly cause?: unknown;
}> {}

/** A git merge or rebase produced conflicts. */
export class MergeConflictError extends Data.TaggedError('MergeConflictError')<{
  readonly branch: string;
  readonly targetBranch: string;
  readonly conflictedFiles: readonly string[];
}> {}

// ─── Tmux errors ──────────────────────────────────────────────────────────────

/** A tmux command failed. */
export class TmuxError extends Data.TaggedError('TmuxError')<{
  readonly command: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Tracker / API errors ─────────────────────────────────────────────────────

/** A generic issue-tracker API call failed. */
export class TrackerError extends Data.TaggedError('TrackerError')<{
  readonly tracker: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A GitHub API call failed. */
export class GitHubApiError extends Data.TaggedError('GitHubApiError')<{
  readonly operation: string;
  readonly status: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A Linear API call failed. */
export class LinearApiError extends Data.TaggedError('LinearApiError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Agent / checkpoint errors ────────────────────────────────────────────────

/** A checkpoint save, load, or delete operation failed. */
export class CheckpointError extends Data.TaggedError('CheckpointError')<{
  readonly agentId: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The supplied agent ID does not match the expected format. */
export class InvalidAgentIdError extends Data.TaggedError('InvalidAgentIdError')<{
  readonly agentId: string;
}> {}

// ─── Configuration errors ─────────────────────────────────────────────────────

/** A configuration value is missing or invalid. */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A configuration file (YAML or JSON) could not be parsed. */
export class ConfigParseError extends Data.TaggedError('ConfigParseError')<{
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Process errors ───────────────────────────────────────────────────────────

/** A child process failed to spawn. */
export class ProcessSpawnError extends Data.TaggedError('ProcessSpawnError')<{
  readonly command: string;
  readonly args: readonly string[];
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A child process exceeded its allowed runtime. */
export class ProcessTimeoutError extends Data.TaggedError('ProcessTimeoutError')<{
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}> {}
