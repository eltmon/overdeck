import { basename, dirname } from 'path';
import { Data, Effect } from 'effect';
import { type RunBdWithRetryOptions } from './bd-process-lock.js';
import { createBeadsResolver } from './beads/resolver.js';

export interface BeadEntry {
  id: string;
  title: string;
  status: string;
  labels: string[];
  description?: string;
  priority?: number;
  [key: string]: unknown;
}

export type ReadyBeadsByIssue = Record<string, BeadEntry[]>;

/** Thrown when an issue has no beads — the typed signal that work-agent gating fails.
 *  If the live bd query failed with a transient lock error, `transientFailure`
 *  carries that cause so callers can emit a retryable "temporarily locked"
 *  message instead of "Planning must create beads". */
export class BeadsMissingError extends Data.TaggedError('BeadsMissingError')<{
  readonly issueId: string;
  readonly workspacePath: string;
  readonly transientFailure?: unknown;
  readonly staleReason?: string;
}> {}

function normalizeIssueLabel(issueId: string): string {
  return issueId.toLowerCase();
}

export function resolveBeadsQueryRoot(workspacePath: string): string {
  const workspaceName = basename(workspacePath);
  const workspacesDir = dirname(workspacePath);
  if (workspaceName.startsWith('feature-') && basename(workspacesDir) === 'workspaces') {
    return dirname(workspacesDir);
  }
  return workspacePath;
}

function beadLabels(entry: unknown): string[] {
  if (typeof entry !== 'object' || entry === null || !Array.isArray((entry as { labels?: unknown }).labels)) return [];
  return (entry as { labels: unknown[] }).labels.filter((label): label is string => typeof label === 'string');
}

function labelMatchesIssue(labels: string[], issueLabel: string): boolean {
  return labels.some((label) => {
    const normalized = label.toLowerCase();
    return normalized === issueLabel || normalized === `workspace:${issueLabel}`;
  });
}

function toBeadEntry(entry: Record<string, unknown>, labels: string[]): BeadEntry {
  const bead: BeadEntry = {
    ...entry,
    id: String(entry.id ?? ''),
    title: String(entry.title ?? ''),
    status: String(entry.status ?? 'open'),
    labels,
  };
  if (typeof entry.description === 'string') bead.description = entry.description;
  if (typeof entry.priority === 'number') bead.priority = entry.priority;
  return bead;
}

function isOpenReadyBead(bead: BeadEntry): boolean {
  if (bead.status.toLowerCase() !== 'open') return false;
  const dependencyCount = bead.dependency_count;
  return typeof dependencyCount !== 'number' || dependencyCount === 0;
}

function groupReadyBeadsByIssue(beads: BeadEntry[], issueLabels: string[]): ReadyBeadsByIssue {
  const result: ReadyBeadsByIssue = Object.fromEntries(issueLabels.map((label) => [label, []]));
  for (const bead of beads) {
    if (!isOpenReadyBead(bead)) continue;
    for (const issueLabel of issueLabels) {
      if (labelMatchesIssue(bead.labels, issueLabel)) {
        result[issueLabel]!.push(bead);
      }
    }
  }
  return result;
}

export interface BeadsQueryResult {
  readonly beads: BeadEntry[];
  readonly transientFailure?: unknown;
  readonly stale?: boolean;
  readonly reason?: string;
}

export interface ReadyBeadsQueryResult {
  readonly byIssue: ReadyBeadsByIssue;
  readonly transientFailure?: unknown;
  readonly stale?: boolean;
  readonly reason?: string;
}

export async function queryBeadsForIssuePromise(
  workspacePath: string,
  issueId: string,
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Promise<BeadsQueryResult> {
  const result = await createBeadsResolver(workspacePath, { retry: retryOptions }).getBeadsForIssue(issueId);
  return result.ok
    ? { beads: result.value.map((entry) => toBeadEntry(entry, beadLabels(entry))) }
    : { beads: [], stale: true, reason: result.reason, transientFailure: result.transient ? result.error : undefined };
}

export async function queryReadyBeadsByIssueLabelsPromise(
  workspacePath: string,
  issueIds: readonly string[],
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Promise<ReadyBeadsQueryResult> {
  const issueLabels = Array.from(new Set(issueIds.map(normalizeIssueLabel)));
  if (issueLabels.length === 0) return { byIssue: {} };

  const result = await createBeadsResolver(workspacePath, { retry: retryOptions }).getAllBeads();
  if (result.ok) {
    const beads = result.value.map((entry) => toBeadEntry(entry, beadLabels(entry)));
    return { byIssue: groupReadyBeadsByIssue(beads, issueLabels) };
  }
  return {
    byIssue: Object.fromEntries(issueLabels.map((label) => [label, []])),
    stale: true,
    reason: result.reason,
    transientFailure: result.transient ? result.error : undefined,
  };
}

export async function assertIssueHasBeadsPromise(
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
      staleReason: result.reason,
    });
  }
}

async function queryBeadByIdPromise(
  workspacePath: string,
  beadId: string,
): Promise<BeadEntry | null> {
  const result = await createBeadsResolver(workspacePath).getBeadById(beadId);
  return result.ok ? result.value : null;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Query beads for an issue. Effect-native. A failed canonical read is marked
 * stale and is never replaced with a derived JSONL snapshot.
 *
 * @param retryOptions - Optional lock/retry tuning. Dashboard callers should
 *   pass a short `acquisitionTimeoutMs` (e.g. 500) so HTTP requests fail fast
 *   quickly instead of blocking behind CLI processes that hold the lock.
 */
export const queryBeadsForIssue = (
  workspacePath: string,
  issueId: string,
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Effect.Effect<BeadsQueryResult> =>
  Effect.promise(() => queryBeadsForIssuePromise(workspacePath, issueId, retryOptions));

/**
 * Query ready/open beads for multiple issue labels from one canonical snapshot.
 */
export const queryReadyBeadsByIssueLabels = (
  workspacePath: string,
  issueIds: readonly string[],
  retryOptions: Omit<RunBdWithRetryOptions, 'workspacePath'> = {},
): Effect.Effect<ReadyBeadsQueryResult> =>
  Effect.promise(() => queryReadyBeadsByIssueLabelsPromise(workspacePath, issueIds, retryOptions));

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
        staleReason: result.reason,
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
