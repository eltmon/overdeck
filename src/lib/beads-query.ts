import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { readFile } from 'node:fs/promises';
import { join } from 'path';
import { Data, Effect } from 'effect';

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

/** Thrown when an issue has no beads — the typed signal that work-agent gating fails. */
export class BeadsMissingError extends Data.TaggedError('BeadsMissingError')<{
  readonly issueId: string;
  readonly workspacePath: string;
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
}async function queryBeadsForIssuePromise(
  workspacePath: string,
  issueId: string
): Promise<BeadEntry[]> {
  try {
    const { stdout } = await execFileAsync(
      'bd',
      ['list', '--json', '-l', issueId.toLowerCase(), '--status', 'all', '--limit', '0'],
      { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 }
    );
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return await readBeadsFromJsonl(workspacePath, issueId);
  }
}async function assertIssueHasBeadsPromise(workspacePath: string, issueId: string): Promise<void> {
  const beads = await Effect.runPromise(queryBeadsForIssue(workspacePath, issueId));
  if (beads.length === 0) {
    const label = issueId.toLowerCase();
    throw new Error(
      `No beads tasks found for ${issueId}. Planning must create beads labeled "${label}" before a work agent can start.`
    );
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
 * Query beads for an issue. Effect-native. Never fails — returns [] on any error
 * (matches the existing Promise contract where bd-down or missing-JSONL is benign).
 */
export const queryBeadsForIssue = (
  workspacePath: string,
  issueId: string,
): Effect.Effect<readonly BeadEntry[]> =>
  Effect.promise(() => queryBeadsForIssuePromise(workspacePath, issueId));

/**
 * Assert the issue has beads. Effect-native. Fails with BeadsMissingError if
 * no beads are found.
 */
export const assertIssueHasBeads = (
  workspacePath: string,
  issueId: string,
): Effect.Effect<void, BeadsMissingError> =>
  Effect.gen(function* () {
    const beads = yield* queryBeadsForIssue(workspacePath, issueId);
    if (beads.length === 0) {
      return yield* Effect.fail(new BeadsMissingError({ issueId, workspacePath }));
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
