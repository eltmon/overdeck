/**
 * PAN-4433: decide from facts whether a dispatched reviewer is silent.
 *
 * A reviewer is silent when its dispatch stamp (`reviewDispatchedAt`) is at
 * least `stallMs` old, it wrote no report for the run since the stamp, and its
 * transcript has not been written since the stamp. The clock is anchored to the
 * dispatch, not to idleness: a convoy parent that read its prompt and then sits
 * in STANDBY is active, not silent. A reviewer that started and later hung is
 * out of scope.
 *
 * Pure: no I/O. The caller (silent-reviewer-recovery.ts) gathers the facts.
 * See docs/PIPELINE-GATES.md.
 */
import { join } from 'node:path';

import { PAN_DIRNAME } from '../pan-dir/types.js';
import type { PipelineJournalEntry } from './pipeline-journal.js';
import { VERDICT_REPORT_FILENAMES } from './review-verdict-report.js';

export interface SilentReviewerFacts {
  agentId: string;
  runId: string;
  dispatchedAtMs: number;
  /** Last transcript write in ms; null = no transcript (never started). */
  lastTranscriptActivityMs: number | null;
  /** A report for this run with mtime >= dispatchedAtMs exists. */
  reportSinceDispatch: boolean;
}

export type SilentVerdict =
  | { silent: false; reason: 'reported' | 'too-young' | 'active' }
  | { silent: true; silentForMs: number };

export function classifyReviewer(facts: SilentReviewerFacts, stallMs: number, now: number): SilentVerdict {
  if (facts.reportSinceDispatch) return { silent: false, reason: 'reported' };
  if (now - facts.dispatchedAtMs < stallMs) return { silent: false, reason: 'too-young' };
  if (facts.lastTranscriptActivityMs !== null && facts.lastTranscriptActivityMs >= facts.dispatchedAtMs) {
    return { silent: false, reason: 'active' };
  }
  return { silent: true, silentForMs: now - facts.dispatchedAtMs };
}

/**
 * Journal entries for (runId, reviewer): how many times it was re-dispatched as
 * silent, when last, and whether it was already escalated. A new push is a new
 * run, so it gets a fresh budget.
 */
export function stallHistory(
  entries: readonly PipelineJournalEntry[],
  runId: string,
  reviewer: string,
): { stalledCount: number; lastStalledAtMs: number | null; escalated: boolean } {
  let stalledCount = 0;
  let lastStalledAtMs: number | null = null;
  let escalated = false;
  for (const entry of entries) {
    if (entry.data?.runId !== runId || entry.data?.reviewer !== reviewer) continue;
    if (entry.type === 'review.stalled') {
      stalledCount += 1;
      const at = Date.parse(entry.at);
      if (Number.isFinite(at) && (lastStalledAtMs === null || at > lastStalledAtMs)) lastStalledAtMs = at;
    } else if (entry.type === 'review.stall-escalated') {
      escalated = true;
    }
  }
  return { stalledCount, lastStalledAtMs, escalated };
}

/** Report paths that count for a reviewer: lane → state.reviewOutputPath ?? <reviewDir>/<subRole>.md; parent → review.md and synthesis.md. */
export function reviewerReportPaths(opts: { workspace: string; runId: string; subRole?: string; reviewOutputPath?: string }): string[] {
  const reviewDir = join(opts.workspace, PAN_DIRNAME, 'review', opts.runId);
  if (opts.subRole) return [opts.reviewOutputPath ?? join(reviewDir, `${opts.subRole}.md`)];
  return VERDICT_REPORT_FILENAMES.map((filename) => join(reviewDir, filename));
}
