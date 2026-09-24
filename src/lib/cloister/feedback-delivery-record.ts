/**
 * Durable "this verdict's feedback already reached the work agent" (#4035).
 *
 * Review and UAT failures are relayed from `pan admin specialists done`, a
 * fresh CLI process per verdict. The keyed delivery tiers (PTY supervisor,
 * tmux user options) remember a key across processes, but a Herdr-prompted
 * agent is reached before that cascade and Herdr remembers message ids only
 * for its own process. So the relay asks the per-issue pipeline journal
 * instead, before resolving a target and before any backend prompt:
 *
 *   - After a fresh delivery the relay appends `feedback.delivered` with the
 *     delivery key. A later relay with the same key skips delivery on every
 *     backend. The entry records that the delivery happened; it says nothing
 *     about PR state, which stays with the PR.
 *   - The key names the verdict episode, not just the head: it folds in how
 *     many passing verdicts of that kind the journal holds. Two failures on
 *     one head with no pass between share a key (delivered once); a pass
 *     between them changes the key, so fail, pass, fail on one head delivers
 *     twice, and the keyed tmux/supervisor stores see a new key too.
 *   - With no passing verdict journaled the key is exactly the pre-#4035 key,
 *     so a first delivery is unchanged.
 *
 * A missing or unreadable journal reads as "not delivered": delivery wins
 * over deduplication.
 */
import { existsSync } from 'node:fs';

import {
  appendPipelineEntry,
  readPipelineJournal,
  type PipelineJournalEntry,
} from './pipeline-journal.js';

export type VerdictFeedbackKind = 'review' | 'uat';

function isPassingVerdict(entry: PipelineJournalEntry, kind: VerdictFeedbackKind): boolean {
  if (kind === 'review') return entry.type === 'review.verdict' && entry.data?.verdict === 'APPROVED';
  return entry.type === 'uat.verdict' && entry.data?.status === 'passed';
}

/** How many passing verdicts of this kind the issue's journal holds. */
export function passingVerdictCount(workspacePath: string | undefined, kind: VerdictFeedbackKind): number {
  if (!workspacePath) return 0;
  return readPipelineJournal(workspacePath).filter((entry) => isPassingVerdict(entry, kind)).length;
}

/**
 * The verdict identity a delivery key is hashed from: the head (or review
 * run), plus the pass episode once a pass has been journaled.
 */
export function verdictEpisodeIdentity(identity: string, passCount: number): string {
  return passCount > 0 ? `${identity}|after-pass:${passCount}` : identity;
}

/** True when the journal already records a delivery under this key. */
export function feedbackAlreadyDelivered(workspacePath: string | undefined, dedupKey: string): boolean {
  if (!workspacePath) return false;
  return readPipelineJournal(workspacePath).some(
    (entry) => entry.type === 'feedback.delivered' && entry.data?.dedupKey === dedupKey,
  );
}

/** Record, at the moment it happened, that verdict feedback reached an agent. */
export function recordFeedbackDelivered(
  workspacePath: string | undefined,
  entry: { issueId: string; kind: VerdictFeedbackKind; dedupKey: string; agentId: string; source: string },
): void {
  if (!workspacePath) return;
  appendPipelineEntry(workspacePath, {
    type: 'feedback.delivered',
    issueId: entry.issueId,
    source: entry.source,
    data: { kind: entry.kind, dedupKey: entry.dedupKey, agentId: entry.agentId },
  });
}

/**
 * Record that a relay skipped re-delivering an already-delivered verdict, and
 * return how many times this key has been skipped since its last delivery
 * (this skip included). The review relay's loop detector reads this count, so
 * it holds across `pan admin specialists done` processes. Returns undefined
 * when there is no workspace to journal to (the caller counts in memory).
 */
export function recordFeedbackSkipped(
  workspacePath: string | undefined,
  entry: { issueId: string; kind: VerdictFeedbackKind; dedupKey: string; source: string },
): number | undefined {
  if (!workspacePath || !existsSync(workspacePath)) return undefined;
  appendPipelineEntry(workspacePath, {
    type: 'feedback.skipped',
    issueId: entry.issueId,
    source: entry.source,
    data: { kind: entry.kind, dedupKey: entry.dedupKey },
  });
  let skipped = 0;
  for (const journaled of readPipelineJournal(workspacePath)) {
    if (journaled.data?.dedupKey !== entry.dedupKey) continue;
    if (journaled.type === 'feedback.delivered') skipped = 0;
    else if (journaled.type === 'feedback.skipped') skipped += 1;
  }
  // An unwritable journal still counts this skip.
  return Math.max(skipped, 1);
}
