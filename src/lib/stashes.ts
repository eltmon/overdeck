import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export type CanonicalStashKind = 'pre-merge' | 'pre-spawn' | 'review-temp' | 'salvageable';

export interface ParsedStashEntry {
  ref: string;
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

function isoForStash(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sanitizeShortDescription(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'recovery';
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
  const normalizedIssueId = issueId.toUpperCase();
  if (kind === 'review-temp') {
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
  const preTimedMatch = /^(pre-merge|pre-spawn):(\w+-\d+):(\d{4}-\d{2}-\d{2}T[^:]+:[^:]+:[^:]+Z)$/.exec(message);
  if (preTimedMatch) {
    return {
      ref: '',
      message,
      kind: preTimedMatch[1] as CanonicalStashKind,
      issueId: preTimedMatch[2].toUpperCase(),
      createdAt: new Date(preTimedMatch[3]),
    };
  }

  const reviewTempMatch = /^review-temp:(\w+-\d+):(\d+)$/.exec(message);
  if (reviewTempMatch) {
    return {
      ref: '',
      message,
      kind: 'review-temp',
      issueId: reviewTempMatch[1].toUpperCase(),
      sequence: parseInt(reviewTempMatch[2], 10),
    };
  }

  const salvageableMatch = /^salvageable:(\w+-\d+):(\d{4}-\d{2}-\d{2}T[^:]+:[^:]+:[^:]+Z):(.+)$/.exec(message);
  if (salvageableMatch) {
    return {
      ref: '',
      message,
      kind: 'salvageable',
      issueId: salvageableMatch[1].toUpperCase(),
      createdAt: new Date(salvageableMatch[2]),
      shortDescription: salvageableMatch[3],
    };
  }

  return { ref: '', message, kind: 'unknown' };
}

export function parseStashListLine(line: string): ParsedStashEntry | null {
  const match = /^(stash@\{\d+\}):\s*(?:On|WIP on)\s+[^:]*:\s*(.*)$/.exec(line.trim());
  if (!match) return null;
  const ref = match[1];
  const message = match[2].trim();
  const parsed = parseCanonicalStashMessage(message);
  return { ...parsed, ref, message };
}

export async function listStashes(repoPath: string): Promise<ParsedStashEntry[]> {
  const { stdout } = await execAsync('git stash list', { cwd: repoPath, encoding: 'utf-8' });
  return stdout
    .split('\n')
    .map((line) => parseStashListLine(line))
    .filter((entry): entry is ParsedStashEntry => entry !== null);
}

export async function createNamedStash(repoPath: string, message: string, includeUntracked = true): Promise<string | null> {
  const command = includeUntracked
    ? `git stash push -u -m ${JSON.stringify(message)}`
    : `git stash push -m ${JSON.stringify(message)}`;
  const { stdout } = await execAsync(command, { cwd: repoPath, encoding: 'utf-8' });
  if (/No local changes to save/i.test(stdout)) return null;
  const stashes = await listStashes(repoPath);
  return stashes.find((entry) => entry.message === message)?.ref ?? null;
}

export async function popStash(repoPath: string, ref: string): Promise<void> {
  await execAsync(`git stash pop ${JSON.stringify(ref)}`, { cwd: repoPath, encoding: 'utf-8' });
}

export async function dropStash(repoPath: string, ref: string): Promise<void> {
  await execAsync(`git stash drop ${JSON.stringify(ref)}`, { cwd: repoPath, encoding: 'utf-8' });
}

export async function applyStash(repoPath: string, ref: string): Promise<void> {
  await execAsync(`git stash apply ${JSON.stringify(ref)}`, { cwd: repoPath, encoding: 'utf-8' });
}

export async function createRecoveryBranchFromStash(
  repoPath: string,
  stashRef: string,
  issueId: string,
  shortDescription: string,
): Promise<string> {
  const branchName = `recovery/${issueId.toUpperCase()}-${sanitizeShortDescription(shortDescription)}`;
  await execAsync(`git branch ${JSON.stringify(branchName)} ${JSON.stringify(stashRef)}`, {
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
