/**
 * The per-issue pipeline journal — an append-only log of what Overdeck DID.
 *
 * PAN-3917 deleted the stored per-issue pipeline record, and rightly so: state
 * is what git, the tracker, the PR and the terminal backend say. But between
 * "PR opened" and "review posted" nothing on disk said what Overdeck was
 * doing, so `pan show` could only answer `in-review`, a work agent told to
 * "confirm the pipeline state change" had nothing to look at and polled for
 * ten minutes (PAN-3705), and a dashboard restart mid-convoy lost the convoy
 * with nothing left to re-dispatch from.
 *
 * This is the one piece of stored pipeline state brought back, and it is
 * deliberately not a status:
 *
 *   - **Append-only.** The server writes one entry at the moment it performs
 *     an action and never rewrites it. There is no update, no delete, no
 *     repair routine, and no API that exports one.
 *   - **Not authority.** Readers take the last entry plus the PR. If the two
 *     disagree, the PR wins and the journal is merely stale.
 *   - **Event-based, never polled.** Appending fires `pipeline.entry` on the
 *     existing pipeline-notifier; consumers subscribe.
 *   - **Disposable.** It lives in the workspace runtime dir beside
 *     `verification-latest.json` and dies with the workspace.
 *
 * An unwritable journal must never break the action that produced it, so every
 * write failure is logged and swallowed.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { notifyPipeline } from '../pipeline-notifier.js';

export type PipelineJournalEntryType =
  | 'verification.started' | 'verification.passed' | 'verification.failed'
  | 'review.requested' | 'review.dispatched' | 'review.redispatched' | 'review.verdict'
  | 'uat.verdict' | 'feedback.delivered' | 'feedback.skipped'
  | 'merge.attempted' | 'merge.completed' | 'merge.failed'
  | 'strike.landed'
  | 'handoff.deferred' | 'handoff.retried' | 'handoff.started' | 'handoff.abandoned';

export interface PipelineJournalEntry {
  /** ISO timestamp, stamped at append time. */
  at: string;
  type: PipelineJournalEntryType;
  issueId: string;
  /** Who acted, e.g. 'pan-done' | 'pan-review-request' | 'webhook' | 'deacon-lite' | 'merge-button' | 'complete-planning'. */
  source?: string;
  data?: Record<string, unknown>;
}

const JOURNAL_RELATIVE_PATH = join('.overdeck', 'pipeline.jsonl');

export function pipelineJournalPath(workspacePath: string): string {
  return join(workspacePath, JOURNAL_RELATIVE_PATH);
}

/**
 * Append one entry and fire `pipeline.entry`.
 *
 * Returns the stamped entry whether or not the write landed: the caller has
 * already performed the action this records, and a failed journal write is not
 * a reason to fail it.
 */
export function appendPipelineEntry(
  workspacePath: string,
  entry: Omit<PipelineJournalEntry, 'at'>,
): PipelineJournalEntry {
  const stamped: PipelineJournalEntry = { at: new Date().toISOString(), ...entry };
  const path = pipelineJournalPath(workspacePath);
  try {
    // The journal dies with the workspace. `mkdir -p` on a reaped workspace
    // would resurrect the tree as an empty ghost, so a missing workspace is a
    // skip, not a write.
    if (!existsSync(workspacePath)) throw new Error(`workspace ${workspacePath} no longer exists`);
    mkdirSync(dirname(path), { recursive: true });
    // A crash can leave a torn last line with no newline. Appending straight
    // after it would glue this entry onto the torn one and both would be
    // skipped as malformed, so start a fresh line first.
    const separator = endsWithoutNewline(path) ? '\n' : '';
    appendFileSync(path, `${separator}${JSON.stringify(stamped)}\n`, 'utf-8');
  } catch (err) {
    console.warn(
      `[pipeline-journal] Could not append ${stamped.type} for ${stamped.issueId} to ${path}: `
      + `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    notifyPipeline({ type: 'pipeline.entry', issueId: stamped.issueId, entry: stamped });
  } catch (err) {
    console.warn(`[pipeline-journal] Could not notify pipeline.entry for ${stamped.issueId}:`, err);
  }
  return stamped;
}

/** True when the file exists, is non-empty, and its last byte is not `\n`. */
function endsWithoutNewline(path: string): boolean {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return false;
  }
  if (size === 0) return false;
  const fd = openSync(path, 'r');
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * Read the journal, oldest entry first. A malformed line is skipped rather
 * than throwing — a half-written line must not blind every reader.
 */
export function readPipelineJournal(
  workspacePath: string,
  opts: { limit?: number } = {},
): PipelineJournalEntry[] {
  const path = pipelineJournalPath(workspacePath);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const entries: PipelineJournalEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as PipelineJournalEntry;
      if (parsed && typeof parsed.type === 'string' && typeof parsed.at === 'string') entries.push(parsed);
    } catch {
      // A truncated or garbled line is evidence of nothing; skip it.
    }
  }
  return opts.limit !== undefined && opts.limit >= 0 ? entries.slice(-opts.limit) : entries;
}

/** The last entry, or the last whose type starts with `prefix`. */
export function lastPipelineEntry(
  workspacePath: string,
  prefix?: string,
): PipelineJournalEntry | null {
  const entries = readPipelineJournal(workspacePath);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!prefix || entry.type.startsWith(prefix)) return entry;
  }
  return null;
}
