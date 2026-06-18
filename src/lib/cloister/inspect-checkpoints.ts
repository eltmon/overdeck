/**
 * PAN-382: Inspection checkpoint system.
 *
 * Tracks commit SHAs where inspections passed. The active inspection diff is
 * scoped to the parent of HEAD because the work role contract is one bead per
 * commit; checkpoints remain the durable record after a pass.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { GitError } from '../errors.js';

const execAsync = promisify(exec);

const OVERDECK_HOME = join(homedir(), '.panopticon');

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
  return join(OVERDECK_HOME, 'specialists', projectKey, 'inspect-agent', 'checkpoints');
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
export function loadCheckpoints(projectKey: string, issueId: string): InspectCheckpointFile | null {
  const filePath = getCheckpointPath(projectKey, issueId);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Get the last checkpoint for an issue, or null if none exist.
 */
export function getLastCheckpoint(projectKey: string, issueId: string): InspectCheckpoint | null {
  const data = loadCheckpoints(projectKey, issueId);
  if (!data || data.checkpoints.length === 0) return null;
  return data.checkpoints[data.checkpoints.length - 1];
}

/**
 * Save a new checkpoint after a successful inspection.
 */
export function saveCheckpoint(
  projectKey: string,
  issueId: string,
  beadId: string,
  commitSha: string
): InspectCheckpoint {
  const dir = getCheckpointDir(projectKey);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const data = loadCheckpoints(projectKey, issueId) || {
    issueId: issueId.toUpperCase(),
    checkpoints: [],
  };

  const checkpoint: InspectCheckpoint = {
    beadId,
    commitSha,
    passedAt: new Date().toISOString(),
  };

  data.checkpoints.push(checkpoint);
  writeFileSync(getCheckpointPath(projectKey, issueId), JSON.stringify(data, null, 2));

  return checkpoint;
}async function getDiffBasePromise(_projectKey: string, _issueId: string, workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD^', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    return stdout.trim();
  } catch {
    // Fallback to 'main' if the branch has no parent commit.
    return 'main';
  }
}async function getDiffStatsPromise(workspacePath: string, diffBase: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git diff --stat ${diffBase}...HEAD`, {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    return stdout.trim() || 'No changes detected';
  } catch {
    return 'Unable to compute diff stats';
  }
}async function getCurrentHeadPromise(workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

// ─── PAN-1249: additive Effect variants ───────────────────────────────────────

/**
 * Effect-typed variant of {@link getDiffBase}. Always succeeds — falls back to
 * `'main'` if `git merge-base` fails, matching the Promise version's behavior.
 */
export function getDiffBase(
  _projectKey: string,
  _issueId: string,
  workspacePath: string,
): Effect.Effect<string> {
  return Effect.tryPromise({
    try: () => execAsync('git rev-parse HEAD^', { cwd: workspacePath, encoding: 'utf-8' }),
    catch: (cause) => new GitError({ command: ['git', 'rev-parse', 'HEAD^'], stderr: String(cause), exitCode: -1, cause }),
  }).pipe(
    Effect.map(({ stdout }) => stdout.trim()),
    Effect.orElseSucceed(() => 'main'),
  );
}

/**
 * Effect-typed variant of {@link getDiffStats}. Always succeeds — returns a
 * human-readable fallback string when the diff command fails.
 */
export function getDiffStats(
  workspacePath: string,
  diffBase: string,
): Effect.Effect<string> {
  return Effect.tryPromise({
    try: () => execAsync(`git diff --stat ${diffBase}...HEAD`, { cwd: workspacePath, encoding: 'utf-8' }),
    catch: (cause) => new GitError({ command: ['git', 'diff', '--stat', `${diffBase}...HEAD`], stderr: String(cause), exitCode: -1, cause }),
  }).pipe(
    Effect.map(({ stdout }) => stdout.trim() || 'No changes detected'),
    Effect.orElseSucceed(() => 'Unable to compute diff stats'),
  );
}

/**
 * Effect-typed variant of {@link getCurrentHead}. Always succeeds — returns
 * `'unknown'` on failure to preserve the Promise version's contract.
 */
export function getCurrentHead(workspacePath: string): Effect.Effect<string> {
  return Effect.tryPromise({
    try: () => execAsync('git rev-parse HEAD', { cwd: workspacePath, encoding: 'utf-8' }),
    catch: (cause) => new GitError({ command: ['git', 'rev-parse', 'HEAD'], stderr: String(cause), exitCode: -1, cause }),
  }).pipe(
    Effect.map(({ stdout }) => stdout.trim()),
    Effect.orElseSucceed(() => 'unknown'),
  );
}
