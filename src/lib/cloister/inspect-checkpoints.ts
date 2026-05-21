/**
 * PAN-382: Inspection checkpoint system.
 *
 * Tracks commit SHAs where inspections passed, scoping subsequent
 * inspection diffs to only the changes since the last checkpoint.
 *
 * First inspection: diff from branch base (main...HEAD)
 * Subsequent: diff from last checkpoint SHA to HEAD
 */
import { existsSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { FsError, GitError } from '../errors.js';

const execAsync = promisify(exec);

const PANOPTICON_HOME = join(homedir(), '.panopticon');

export interface InspectCheckpoint {
  beadId: string;
  commitSha: string;
  passedAt: string; // ISO 8601
}

export interface InspectCheckpointFile {
  issueId: string;
  checkpoints: InspectCheckpoint[];
}

/**
 * Get the directory for a project's inspect checkpoints.
 */
function getCheckpointDir(projectKey: string): string {
  return join(PANOPTICON_HOME, 'specialists', projectKey, 'inspect-agent', 'checkpoints');
}

/**
 * Get the checkpoint file path for an issue.
 */
function getCheckpointPath(projectKey: string, issueId: string): string {
  return join(getCheckpointDir(projectKey), `${issueId.toUpperCase()}.json`);
}

/**
 * Load checkpoints for an issue. Returns null if no checkpoints exist.
 */
export function loadCheckpoints(
  projectKey: string,
  issueId: string,
): Effect.Effect<InspectCheckpointFile | null> {
  const filePath = getCheckpointPath(projectKey, issueId);
  if (!existsSync(filePath)) return Effect.succeed(null);

  return Effect.tryPromise({
    try: async () => JSON.parse(await readFile(filePath, 'utf-8')) as InspectCheckpointFile,
    catch: (e) => new FsError({ path: filePath, operation: 'read', cause: e }),
  }).pipe(Effect.catch(() => Effect.succeed(null)));
}

/**
 * Get the last checkpoint for an issue, or null if none exist.
 */
export function getLastCheckpoint(
  projectKey: string,
  issueId: string,
): Effect.Effect<InspectCheckpoint | null> {
  return Effect.gen(function* () {
    const data = yield* loadCheckpoints(projectKey, issueId);
    if (!data || data.checkpoints.length === 0) return null;
    return data.checkpoints[data.checkpoints.length - 1] ?? null;
  });
}

/**
 * Save a new checkpoint after a successful inspection.
 */
export function saveCheckpoint(
  projectKey: string,
  issueId: string,
  beadId: string,
  commitSha: string,
): Effect.Effect<InspectCheckpoint, FsError> {
  return Effect.gen(function* () {
    const dir = getCheckpointDir(projectKey);
    if (!existsSync(dir)) {
      yield* Effect.tryPromise({
        try: () => mkdir(dir, { recursive: true }),
        catch: (e) => new FsError({ path: dir, operation: 'mkdir', cause: e }),
      });
    }

    const existing = yield* loadCheckpoints(projectKey, issueId);
    const data: InspectCheckpointFile = existing ?? {
      issueId: issueId.toUpperCase(),
      checkpoints: [],
    };

    const checkpoint: InspectCheckpoint = {
      beadId,
      commitSha,
      passedAt: new Date().toISOString(),
    };

    data.checkpoints.push(checkpoint);

    const filePath = getCheckpointPath(projectKey, issueId);
    yield* Effect.tryPromise({
      try: () => writeFile(filePath, JSON.stringify(data, null, 2)),
      catch: (e) => new FsError({ path: filePath, operation: 'write', cause: e }),
    });

    return checkpoint;
  });
}

/**
 * Get the diff base for an inspection.
 *
 * - If a previous checkpoint exists, diff from that commit
 * - Otherwise, diff from the merge-base with main (full branch diff)
 *
 * Returns the commit SHA or ref to diff from.
 */
export function getDiffBase(
  projectKey: string,
  issueId: string,
  workspacePath: string,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const lastCheckpoint = yield* getLastCheckpoint(projectKey, issueId);
    if (lastCheckpoint) {
      return lastCheckpoint.commitSha;
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const { stdout } = await execAsync('git merge-base main HEAD', {
          cwd: workspacePath,
          encoding: 'utf-8',
        });
        return stdout.trim();
      },
      catch: (e) => new GitError({
        command: ['git', 'merge-base', 'main', 'HEAD'],
        stderr: String(e),
        exitCode: 1,
        cause: e,
      }),
    }).pipe(Effect.catch(() => Effect.succeed('main')));
  });
}

/**
 * Get the diff stats (files changed, insertions, deletions) for the inspection scope.
 */
export function getDiffStats(workspacePath: string, diffBase: string): Effect.Effect<string> {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(`git diff --stat ${diffBase}...HEAD`, {
        cwd: workspacePath,
        encoding: 'utf-8',
      });
      return stdout.trim() || 'No changes detected';
    },
    catch: (e) => new GitError({
      command: ['git', 'diff', '--stat', `${diffBase}...HEAD`],
      stderr: String(e),
      exitCode: 1,
      cause: e,
    }),
  }).pipe(Effect.catch(() => Effect.succeed('Unable to compute diff stats')));
}

/**
 * Get the current HEAD commit SHA.
 */
export function getCurrentHead(workspacePath: string): Effect.Effect<string> {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync('git rev-parse HEAD', {
        cwd: workspacePath,
        encoding: 'utf-8',
      });
      return stdout.trim();
    },
    catch: (e) => new GitError({
      command: ['git', 'rev-parse', 'HEAD'],
      stderr: String(e),
      exitCode: 1,
      cause: e,
    }),
  }).pipe(Effect.catch(() => Effect.succeed('unknown')));
}
