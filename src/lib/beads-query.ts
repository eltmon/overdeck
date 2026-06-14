import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { readFile } from 'node:fs/promises';
import { join } from 'path';
import { Data, Effect } from 'effect';
import { BdTransientFailure, runBdWithRetry, type RunBdWithRetryOptions } from './bd-process-lock.js';

const execFileAsync = promisify(execFile);

export interface BeadEntry {
  id: string;
  title: string;
  status: string;
  labels: string[];
  description?: string;
  priority?: number;
  [key: string]: unknown;
}

/** Thrown when an issue has no beads — the typed signal that work-agent gating fails.
 *  If the live bd query failed with a transient lock error, `transientFailure`
 *  carries that cause so callers can emit a retryable "temporarily locked"
 *  message instead of "Planning must create beads". */
export class BeadsMissingError extends Data.TaggedError('BeadsMissingError')<{
  readonly issueId: string;
  readonly workspacePath: string;
  readonly transientFailure?: unknown;
}> {}

async function readBeadsFromJsonl(workspacePath: string, issueId: string): Promise<BeadEntry[]> {
  try {
    const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
    if (!existsSync(jsonlPath)) return [];
    const raw = await readFile(jsonlPath, 'utf-8');
    const beads: BeadEntry[] = [];
    const label = issueId.toLowerCase();
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const labels: string[] = Array.isArray(entry.labels) ? entry.labels : [];
        if (labels.some((l: string) => l.toLowerCase() === label || l.toLowerCase() === `workspace:${label}`)) {
          beads.push({
            id: String(entry.id ?? ''),
            title: String(entry.title ?? ''),
            status: String(entry.status ?? 'open'),
            labels,
            description: entry.description,
            priority: entry.priority,
          });
        }
      } catch { /* skip malformed lines */ }
    }
    return beads;
  } catch {
    return [];
  }
}export interface BeadsQueryResult {
  readonly beads: BeadEntry[];
  readonly transientFailure?: unknown;
}

export async function queryBeadsForIssuePromise(
  workspacePath: string,
  issueId: string,
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Promise<BeadsQueryResult> {
  try {
    const { stdout } = await runBdWithRetry(
      `query beads for ${issueId}`,
      () => execFileAsync(
        'bd',
        ['list', '--json', '-l', issueId.toLowerCase(), '--status', 'all', '--limit', '0'],
        { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 },
      ),
      { ...retryOptions, workspacePath },
    );
    const parsed = JSON.parse(stdout || '[]');
    return { beads: Array.isArray(parsed) ? parsed : [] };
  } catch (error) {
    const beads = await readBeadsFromJsonl(workspacePath, issueId);
    return {
      beads,
      transientFailure: error instanceof BdTransientFailure ? error : undefined,
    };
  }
}async function assertIssueHasBeadsPromise(
  workspacePath: string,
  issueId: string,
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Promise<void> {
  const result = await Effect.runPromise(queryBeadsForIssue(workspacePath, issueId, retryOptions));
  if (result.beads.length === 0) {
    throw new BeadsMissingError({
      issueId,
      workspacePath,
      transientFailure: result.transientFailure,
    });
  }
}async function queryBeadByIdPromise(
  workspacePath: string,
  beadId: string
): Promise<BeadEntry | null> {
  try {
    const { stdout } = await execFileAsync(
      'bd',
      ['show', beadId, '--json'],
      { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 }
    );
    const parsed = JSON.parse(stdout || '[]');
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr[0] ?? null;
  } catch {
    return null;
  }
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Query beads for an issue. Effect-native. Never fails: falls back to the
 * workspace JSONL bead store when bd is unavailable or transiently locked.
 *
 * @param retryOptions - Optional lock/retry tuning. Dashboard callers should
 *   pass a short `acquisitionTimeoutMs` (e.g. 500) so HTTP requests fail fast
 *   to JSONL instead of blocking behind CLI processes that hold the lock.
 */
export const queryBeadsForIssue = (
  workspacePath: string,
  issueId: string,
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Effect.Effect<BeadsQueryResult> =>
  Effect.promise(() => queryBeadsForIssuePromise(workspacePath, issueId, retryOptions));

/**
 * Assert the issue has beads. Effect-native. Fails with BeadsMissingError if
 * no beads are found; the error carries `transientFailure` when the live bd
 * query exhausted its retries under lock contention.
 */
export const assertIssueHasBeads = (
  workspacePath: string,
  issueId: string,
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Effect.Effect<void, BeadsMissingError> =>
  Effect.gen(function* () {
    const result = yield* queryBeadsForIssue(workspacePath, issueId, retryOptions);
    if (result.beads.length === 0) {
      return yield* Effect.fail(new BeadsMissingError({
        issueId,
        workspacePath,
        transientFailure: result.transientFailure,
      }));
    }
  });

/**
 * Look up a single bead by ID. Effect-native. Never fails — returns null on any
 * error.
 */
export const queryBeadById = (
  workspacePath: string,
  beadId: string,
): Effect.Effect<BeadEntry | null> =>
  Effect.promise(() => queryBeadByIdPromise(workspacePath, beadId));
