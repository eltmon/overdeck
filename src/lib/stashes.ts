import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { GitError } from './errors.js';

const execAsync = promisify(exec);

export type CanonicalStashKind = 'pre-merge' | 'pre-spawn' | 'review-temp' | 'salvageable';

export interface ParsedStashEntry {
  /** Stable stash object SHA for persisted references. */
  ref: string;
  /** Current stack position (e.g. stash@{0}) for display and index-based ordering. */
  stackRef?: string;
  message: string;
  createdAt?: Date;
  issueId?: string;
  kind: CanonicalStashKind | 'unknown';
  shortDescription?: string;
  sequence?: number;
}

export interface SalvageableStashEntry extends ParsedStashEntry {
  kind: 'salvageable';
  issueId: string;
  shortDescription: string;
}

const ISO_STASH_TIMESTAMP_PATTERN = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2}))';
const ISSUE_ID_PATTERN = '([A-Z]+(?:-[A-Z]+)*-\\d+)';
const ISSUE_ID_REGEX = new RegExp(`^${ISSUE_ID_PATTERN}$`);

function isoForStash(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeStashTimestamp(value: string): string {
  return value
    .replace(/\.\d+(Z|[+-]\d{2}:\d{2})$/, '$1')
    .replace(/\+00:00$/, 'Z');
}

function sanitizeShortDescription(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'recovery';
}

function validateIssueId(issueId: string): string {
  const normalizedIssueId = issueId.toUpperCase();
  if (!ISSUE_ID_REGEX.test(normalizedIssueId)) {
    throw new Error(`Invalid issue ID format: ${issueId}`);
  }
  return normalizedIssueId;
}

export function buildStashMessage(
  kind: 'pre-merge' | 'pre-spawn',
  issueId: string,
  date?: Date,
): string;
export function buildStashMessage(
  kind: 'review-temp',
  issueId: string,
  sequence: number,
): string;
export function buildStashMessage(
  kind: 'salvageable',
  issueId: string,
  date: Date,
  shortDescription: string,
): string;
export function buildStashMessage(
  kind: CanonicalStashKind,
  issueId: string,
  arg3: Date | number = new Date(),
  arg4?: string,
): string {
  const normalizedIssueId = validateIssueId(issueId);
  if (kind === 'review-temp') {
    // PAN-879 / GitHub issue #879: review-temp is the canonical sequence-based exception
    // to the timestamped stash taxonomy. Acceptance criteria were updated to match.
    return `review-temp:${normalizedIssueId}:${arg3}`;
  }
  if (kind === 'salvageable') {
    const when = arg3 instanceof Date ? arg3 : new Date();
    return `salvageable:${normalizedIssueId}:${isoForStash(when)}:${sanitizeShortDescription(arg4 ?? 'recovery')}`;
  }
  const when = arg3 instanceof Date ? arg3 : new Date();
  return `${kind}:${normalizedIssueId}:${isoForStash(when)}`;
}

export function parseCanonicalStashMessage(message: string): ParsedStashEntry {
  const preTimedMatch = new RegExp(`^(pre-merge|pre-spawn):${ISSUE_ID_PATTERN}:${ISO_STASH_TIMESTAMP_PATTERN}$`).exec(message);
  if (preTimedMatch) {
    return {
      ref: '',
      message,
      kind: preTimedMatch[1] as CanonicalStashKind,
      issueId: preTimedMatch[2].toUpperCase(),
      createdAt: new Date(normalizeStashTimestamp(preTimedMatch[3])),
    };
  }

  const reviewTempMatch = new RegExp(`^review-temp:${ISSUE_ID_PATTERN}:(\\d+)$`).exec(message);
  if (reviewTempMatch) {
    return {
      ref: '',
      message,
      kind: 'review-temp',
      issueId: reviewTempMatch[1].toUpperCase(),
      sequence: parseInt(reviewTempMatch[2], 10),
    };
  }

  const salvageableMatch = new RegExp(`^salvageable:${ISSUE_ID_PATTERN}:${ISO_STASH_TIMESTAMP_PATTERN}:(.+)$`).exec(message);
  if (salvageableMatch) {
    return {
      ref: '',
      message,
      kind: 'salvageable',
      issueId: salvageableMatch[1].toUpperCase(),
      createdAt: new Date(normalizeStashTimestamp(salvageableMatch[2])),
      shortDescription: salvageableMatch[3],
    };
  }

  return { ref: '', message, kind: 'unknown' };
}

export function parseStashListLine(line: string): ParsedStashEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const formattedMatch = /^(stash@\{\d+\})\t([0-9a-f]{40})\t([^\t]+)\t(.*)$/.exec(trimmed);
  if (formattedMatch) {
    const [, stackRef, ref, createdAtRaw, decoratedMessage] = formattedMatch;
    const messageMatch = /^(?:On|WIP on)\s+[^:]*:\s*(.*)$/.exec(decoratedMessage.trim());
    const message = (messageMatch?.[1] ?? decoratedMessage).trim();
    const parsed = parseCanonicalStashMessage(message);
    const createdAt = new Date(normalizeStashTimestamp(createdAtRaw));
    return {
      ...parsed,
      ref,
      stackRef,
      message,
      createdAt: Number.isNaN(createdAt.getTime()) ? parsed.createdAt : createdAt,
    };
  }

  const legacyMatch = /^(stash@\{\d+\}):\s*(?:On|WIP on)\s+[^:]*:\s*(.*)$/.exec(trimmed);
  if (!legacyMatch) return null;
  const stackRef = legacyMatch[1];
  const message = legacyMatch[2].trim();
  const parsed = parseCanonicalStashMessage(message);
  return { ...parsed, ref: stackRef, stackRef, message };
}async function listStashesPromise(repoPath: string): Promise<ParsedStashEntry[]> {
  const { stdout } = await execAsync('git stash list --format="%gd%x09%H%x09%cI%x09%gs"', {
    cwd: repoPath,
    encoding: 'utf-8',
  });
  return stdout
    .split('\n')
    .map((line) => parseStashListLine(line))
    .filter((entry): entry is ParsedStashEntry => entry !== null);
}async function createNamedStashPromise(repoPath: string, message: string, includeUntracked = true): Promise<string | null> {
  const command = includeUntracked
    ? `git stash push -u -m ${JSON.stringify(message)}`
    : `git stash push -m ${JSON.stringify(message)}`;
  const { stdout } = await execAsync(command, { cwd: repoPath, encoding: 'utf-8' });
  if (/No local changes to save/i.test(stdout)) return null;

  const { stdout: stashRef } = await execAsync('git rev-parse --verify stash@{0}', {
    cwd: repoPath,
    encoding: 'utf-8',
  });
  const normalizedRef = stashRef.trim();
  return normalizedRef || null;
}

async function resolveStashOperationRef(repoPath: string, ref: string, stackRef?: string): Promise<string> {
  // PAN-879 assumes stash janitor / merge / review flows are serialized within a single
  // workspace. Per-workspace stash operations must not run concurrently; callers may
  // resolve a stack slot and immediately consume it, but another stash mutation in between
  // can still shift indices. The rev-parse checks below re-validate the resolved slot
  // against the expected SHA immediately before use.
  const candidateRef = /^stash@\{\d+\}$/.test(ref) ? ref : stackRef;
  if (candidateRef) {
    const { stdout: resolvedSha } = await execAsync(`git rev-parse --verify ${JSON.stringify(candidateRef)}`, {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    if (/^stash@\{\d+\}$/.test(ref) || resolvedSha.trim() === ref) {
      return candidateRef;
    }
    throw new Error(`Stash ${ref} no longer matches ${candidateRef}`);
  }

  const stashes = await Effect.runPromise(listStashes(repoPath));
  const matchingEntry = stashes.find((entry) => entry.ref === ref);
  if (!matchingEntry?.stackRef) {
    throw new Error(`Stash ${ref} not found`);
  }

  const { stdout: resolvedSha } = await execAsync(`git rev-parse --verify ${JSON.stringify(matchingEntry.stackRef)}`, {
    cwd: repoPath,
    encoding: 'utf-8',
  });
  if (resolvedSha.trim() !== ref) {
    throw new Error(`Stash ${ref} no longer matches ${matchingEntry.stackRef}`);
  }

  return matchingEntry.stackRef;
}async function popStashPromise(repoPath: string, ref: string, stackRef?: string): Promise<void> {
  const operationRef = await resolveStashOperationRef(repoPath, ref, stackRef);
  await execAsync(`git stash pop ${JSON.stringify(operationRef)}`, { cwd: repoPath, encoding: 'utf-8' });
}async function dropStashPromise(repoPath: string, ref: string, stackRef?: string): Promise<void> {
  const operationRef = await resolveStashOperationRef(repoPath, ref, stackRef);
  await execAsync(`git stash drop ${JSON.stringify(operationRef)}`, { cwd: repoPath, encoding: 'utf-8' });
}async function applyStashPromise(repoPath: string, ref: string, stackRef?: string): Promise<void> {
  const operationRef = await resolveStashOperationRef(repoPath, ref, stackRef);
  await execAsync(`git stash apply ${JSON.stringify(operationRef)}`, { cwd: repoPath, encoding: 'utf-8' });
}async function createRecoveryBranchFromStashPromise(
  repoPath: string,
  stashRef: string,
  issueId: string,
  shortDescription: string,
  stackRef?: string,
): Promise<string> {
  const operationRef = await resolveStashOperationRef(repoPath, stashRef, stackRef);
  const normalizedIssueId = validateIssueId(issueId);
  const branchName = `recovery/${normalizedIssueId}-${sanitizeShortDescription(shortDescription)}`;
  await execAsync(`git branch ${JSON.stringify(branchName)} ${JSON.stringify(operationRef)}`, {
    cwd: repoPath,
    encoding: 'utf-8',
  });
  return branchName;
}

export function getNextReviewTempSequence(entries: ParsedStashEntry[], issueId: string): number {
  const normalizedIssueId = issueId.toUpperCase();
  const maxSequence = entries.reduce((max, entry) => {
    if (entry.kind !== 'review-temp' || entry.issueId !== normalizedIssueId || entry.sequence === undefined) {
      return max;
    }
    return Math.max(max, entry.sequence);
  }, 0);
  return maxSequence + 1;
}

export function isOlderThanDays(entry: ParsedStashEntry, days: number, now = new Date()): boolean {
  if (!entry.createdAt) return false;
  return now.getTime() - entry.createdAt.getTime() > days * 24 * 60 * 60 * 1000;
}

export function isSalvageableStash(entry: ParsedStashEntry): entry is SalvageableStashEntry {
  return entry.kind === 'salvageable' && !!entry.issueId && !!entry.shortDescription;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const toGitError = (op: string, cause: unknown): GitError =>
  new GitError({
    command: ['git', 'stash', op],
    stderr: cause instanceof Error ? cause.message : String(cause),
    exitCode: 1,
    cause,
  });

/** List parsed stash entries (newest first per git's natural ordering). */
export const listStashes = (
  repoPath: string,
): Effect.Effect<readonly ParsedStashEntry[], GitError> =>
  Effect.tryPromise({
    try: () => listStashesPromise(repoPath),
    catch: (cause) => toGitError('list', cause),
  });

/** Create a named stash; returns null if there were no changes to save. */
export const createNamedStash = (
  repoPath: string,
  message: string,
  includeUntracked = true,
): Effect.Effect<string | null, GitError> =>
  Effect.tryPromise({
    try: () => createNamedStashPromise(repoPath, message, includeUntracked),
    catch: (cause) => toGitError('push', cause),
  });

/** Pop a stash by SHA (preferred) or stack ref. */
export const popStash = (
  repoPath: string,
  ref: string,
  stackRef?: string,
): Effect.Effect<void, GitError> =>
  Effect.tryPromise({
    try: () => popStashPromise(repoPath, ref, stackRef),
    catch: (cause) => toGitError('pop', cause),
  });

/** Drop a stash by SHA (preferred) or stack ref. */
export const dropStash = (
  repoPath: string,
  ref: string,
  stackRef?: string,
): Effect.Effect<void, GitError> =>
  Effect.tryPromise({
    try: () => dropStashPromise(repoPath, ref, stackRef),
    catch: (cause) => toGitError('drop', cause),
  });

/** Apply a stash without removing it. */
export const applyStash = (
  repoPath: string,
  ref: string,
  stackRef?: string,
): Effect.Effect<void, GitError> =>
  Effect.tryPromise({
    try: () => applyStashPromise(repoPath, ref, stackRef),
    catch: (cause) => toGitError('apply', cause),
  });

/** Materialise a recovery branch from a stash. Returns the new branch name. */
export const createRecoveryBranchFromStash = (
  repoPath: string,
  stashRef: string,
  issueId: string,
  shortDescription: string,
  stackRef?: string,
): Effect.Effect<string, GitError> =>
  Effect.tryPromise({
    try: () =>
      createRecoveryBranchFromStashPromise(repoPath, stashRef, issueId, shortDescription, stackRef),
    catch: (cause) => toGitError('branch', cause),
  });
