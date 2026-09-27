/**
 * Deferred review verdicts, write half (PAN-4263).
 *
 * A review verdict whose recording fails for a transient forge reason (rate
 * limit, network) is saved as a `review.verdict-deferred` journal entry so
 * deacon-lite can record it later through the same CLI door
 * (`deferred-verdict-replay.ts`). The journal is never authority: the replay
 * re-runs every guard of `pan admin specialists done` under the original caller.
 */

import { appendPipelineEntry } from './pipeline-journal.js';

/** Linux caps one argv string at 131 072 bytes (MAX_ARG_STRLEN); the replay passes notes as one. */
export const DEFERRED_VERDICT_NOTES_MAX_BYTES = 100_000;
const TRUNCATION_SUFFIX = '\n\n[notes truncated by deferred-verdict replay]';

/** `notes` cut to fit {@link DEFERRED_VERDICT_NOTES_MAX_BYTES} on a character boundary, with a suffix saying so. */
export function capDeferredNotes(notes: string): string {
  if (Buffer.byteLength(notes, 'utf-8') <= DEFERRED_VERDICT_NOTES_MAX_BYTES) return notes;
  const budget = DEFERRED_VERDICT_NOTES_MAX_BYTES - Buffer.byteLength(TRUNCATION_SUFFIX, 'utf-8');
  let bytes = 0;
  let kept = '';
  for (const char of notes) {
    bytes += Buffer.byteLength(char, 'utf-8');
    if (bytes > budget) break;
    kept += char;
  }
  return kept + TRUNCATION_SUFFIX;
}

export interface DeferredReviewVerdict {
  status: 'passed' | 'failed' | 'blocked';
  runId?: string;
  notes?: string;
  /** The agent that recorded the verdict; `null` for an operator. */
  callerId: string | null;
  reason: string;
}

/** Journal a review verdict that could not be recorded, for deacon-lite to replay. */
export function deferReviewVerdict(workspacePath: string, issueId: string, verdict: DeferredReviewVerdict): void {
  appendPipelineEntry(workspacePath, {
    type: 'review.verdict-deferred',
    issueId,
    source: 'pan-specialists-done',
    data: {
      status: verdict.status,
      runId: verdict.runId ?? null,
      notes: verdict.notes ? capDeferredNotes(verdict.notes) : null,
      callerId: verdict.callerId,
      reason: verdict.reason,
    },
  });
}
