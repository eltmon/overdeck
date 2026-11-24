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
  | 'review.requested' | 'review.dispatched' | 'review.redispatched' | 'review.halted' | 'review.verdict'
  | 'review.verdict-refused' | 'review.aborted' | 'review.synthesis-gave-up'
  | 'review.verdict-deferred' | 'review.verdict-replay-gave-up'
  | 'review.stalled' | 'review.stall-escalated' | 'review.dispatch-failed' | 'review.resume-declined'
  | 'review.approval-carried' | 'review.stale-approval-rerequested'
  | 'uat.verdict' | 'feedback.delivered' | 'feedback.skipped'
  | 'feedback.undelivered' | 'feedback.followup_filed' | 'feedback.followup_failed'
  | 'merge.attempted' | 'merge.completed' | 'merge.failed'
  | 'strike.landed'
  | 'conflict.repair-requested' | 'conflict.repair-escalated'
  | 'blocked.declared' | 'blocked.woken'
  | 'handoff.requested' | 'handoff.deferred' | 'handoff.retried' | 'handoff.started' | 'handoff.abandoned'
  | 'workspace.adopted' | 'workspace.adoption-failed' | 'workspace.synced-to-pr-head'
  | 'operator.decision-requested' | 'operator.decision-answered' | 'operator.decision-withdrawn'
  | 'stack.reclaimed' | 'stack.restored';

export interface PipelineJournalEntry {
  /** ISO timestamp, stamped at append time. */
  at: string;
  type: PipelineJournalEntryType;
  issueId: string;
  /** Who acted, e.g. 'pan-done' | 'pan-review-request' | 'webhook' | 'deacon-lite' | 'remote-reap' | 'merge-button' | 'complete-planning'. */
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
 * than throwing — a half-written line must not blind every reader. Returns
 * `null` when the journal exists but cannot be read (e.g. it is a directory,
 * or a permissions error), so a caller that must fail closed can tell that
 * apart from a workspace that simply has no journal yet. Use
 * `readPipelineJournal` when an empty result is an acceptable stand-in for
 * "unreadable".
 */
export function tryReadPipelineJournal(
  workspacePath: string,
  opts: { limit?: number } = {},
): PipelineJournalEntry[] | null {
  const path = pipelineJournalPath(workspacePath);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
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

/** `tryReadPipelineJournal`, with an unreadable journal treated as empty. */
export function readPipelineJournal(
  workspacePath: string,
  opts: { limit?: number } = {},
): PipelineJournalEntry[] {
  return tryReadPipelineJournal(workspacePath, opts) ?? [];
}

/**
 * PAN-3911: a review run that has not posted its verdict. Only the LAST entry
 * overall decides, the same rule stalled-review recovery uses: a verdict,
 * delivered feedback or a failed verification after the request ends the run.
 */
export function isReviewInFlightEntry(entry: Pick<PipelineJournalEntry, 'type'> | null): boolean {
  return entry?.type === 'review.requested' || entry?.type === 'review.dispatched' || entry?.type === 'review.redispatched';
}

/** PAN-5623: a `stack.*` entry records what Overdeck did to an issue's containers, not a pipeline step. */
export function isHousekeepingEntry(entry: Pick<PipelineJournalEntry, 'type'>): boolean {
  return entry.type.startsWith('stack.');
}

/** The last entry that is a pipeline step (housekeeping entries skipped), or null. */
export function lastPipelineStep(entries: readonly PipelineJournalEntry[]): PipelineJournalEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!isHousekeepingEntry(entries[index])) return entries[index];
  }
  return null;
}

/** Why a reclaim stopped containers. An entry without `reason` predates PAN-5250 and is a memory reclaim. */
export type StackReclaimReason = 'gate-starvation' | 'idle';

export interface OpenStackReclaim {
  /** Newest open reclaim entry's timestamp. */
  at: string;
  /** Union, in journal order without duplicates, of every open reclaim entry's container names. */
  containers: string[];
  /** Newest open reclaim entry's compose project. */
  composeProject: string | null;
  /** Distinct reasons of the open reclaim entries. */
  reasons: StackReclaimReason[];
  /** PAN-5250 D4: the newest entry alone, for the stop sequences' read-back check. */
  latestAt: string;
  latestContainers: string[];
  /** PAN-5250 FR-9: container name → the service its reclaim entry recorded (from paired data.containers/data.services). */
  recordedServices: Record<string, string>;
}

function reclaimReason(entry: PipelineJournalEntry): StackReclaimReason {
  return entry.data?.reason === 'idle' ? 'idle' : 'gate-starvation';
}

function recordedServicesOf(entry: PipelineJournalEntry): [string, string][] {
  const names = Array.isArray(entry.data?.containers) ? entry.data.containers : [];
  const services = Array.isArray(entry.data?.services) ? entry.data.services : [];
  return names.flatMap((name: unknown, i): [string, string][] => {
    const service: unknown = services[i];
    return typeof name === 'string' && name.length > 0 && typeof service === 'string' ? [[name, service]] : [];
  });
}

/**
 * PAN-5623/PAN-5250: every `stack.reclaimed` entry after the newest `stack.restored`,
 * merged. Entries without a valid container name are skipped. Null when nothing is open.
 */
export function openStackReclaim(entries: readonly PipelineJournalEntry[]): OpenStackReclaim | null {
  const open: { entry: PipelineJournalEntry; containers: string[] }[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === 'stack.restored') break;
    if (entry.type !== 'stack.reclaimed') continue;
    const raw = entry.data?.containers;
    const containers = Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string' && name.length > 0) : [];
    if (containers.length > 0) open.unshift({ entry, containers });
  }
  if (open.length === 0) return null;
  const latest = open[open.length - 1];
  const project = latest.entry.data?.composeProject;
  return {
    at: latest.entry.at,
    containers: [...new Set(open.flatMap((item) => item.containers))],
    composeProject: typeof project === 'string' ? project : null,
    reasons: [...new Set(open.map((item) => reclaimReason(item.entry)))],
    latestAt: latest.entry.at,
    latestContainers: latest.containers,
    recordedServices: Object.fromEntries(open.flatMap(({ entry }) => recordedServicesOf(entry))),
  };
}

/** PAN-5250 FR-8: whether the open reclaim may be restored by an agent turn. */
export function reclaimRestoresOnTurn(open: OpenStackReclaim | null): boolean {
  return open !== null && open.reasons.includes('gate-starvation');
}

/** PAN-5623 D8: whether this issue was already reclaimed in the episode that opened at `episodeSince`. */
export function reclaimedInEpisode(entries: readonly PipelineJournalEntry[], episodeSince: string): boolean {
  return entries.some((entry) => entry.type === 'stack.reclaimed' && entry.data?.episodeSince === episodeSince);
}

/** The last pipeline step (housekeeping entries skipped), or the last entry whose type starts with `prefix`. */
export function lastPipelineEntry(
  workspacePath: string,
  prefix?: string,
): PipelineJournalEntry | null {
  const entries = readPipelineJournal(workspacePath);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (prefix ? entry.type.startsWith(prefix) : !isHousekeepingEntry(entry)) return entry;
  }
  return null;
}
