/**
 * PAN-5218: which advisory review findings did the work agent leave unsettled
 * when the PR merged?
 *
 * A CodeRabbit relay journals `feedback.delivered` (or `feedback.undelivered`
 * when no agent could take it) with the PR, the review and every relayed
 * thread. After the merge, each thread is settled when any of these holds:
 *
 * - T: someone other than CodeRabbit replied on the thread;
 * - P: a single-parent PR commit later than the delivery changed the thread's file;
 * - R: a `review.requested` note later than the delivery names the thread id in
 *   its `CodeRabbit <thread ids>:` segment. Ids match exactly, so `111` never
 *   settles `11`.
 *
 * A failed forge read is no evidence: a redundant follow-up costs one closed
 * issue, a false "settled" loses the finding. Pure: no I/O.
 */
import type { PipelineJournalEntry } from './pipeline-journal.js';

export const ADVISORY_FOLLOWUP_KINDS: readonly string[] = ['coderabbit'];

export interface AdvisoryThreadRecord { id: number; path?: string; line?: number; severity?: string; title: string; url?: string }

/** The `data` of a feedback.delivered / feedback.undelivered entry for an advisory kind (FR-2, FR-3). */
export interface AdvisoryDeliveryData {
  kind: string; dedupKey: string; agentId?: string; reason?: string;
  repo: string; prNumber: number; reviewId: number; reviewUrl?: string;
  threads: AdvisoryThreadRecord[];
}

export interface SettlementCommit { sha: string; committedAt: string; /** null when the per-commit read failed */ files: string[] | null }

export interface PullRequestSettlementFacts {
  /** Single-parent PR commits later than the cutoff; null when the commit list read failed. */
  commits: SettlementCommit[] | null;
  /** Thread ids with a reply from someone other than CodeRabbit; null when the read failed. */
  repliedThreadIds: number[] | null;
}

export type AdvisorySettlement =
  | { outcome: 'already-filed' | 'already-failed' | 'legacy' | 'settled'; dedupKey: string }
  | { outcome: 'unsettled'; dedupKey: string; at: string; data: AdvisoryDeliveryData; threads: AdvisoryThreadRecord[] };

const CANDIDATE_TYPES = new Set<string>(['feedback.delivered', 'feedback.undelivered']);

function dedupKeyOf(entry: PipelineJournalEntry): string | null {
  const key = entry.data?.dedupKey;
  return typeof key === 'string' && key ? key : null;
}

function isAdvisoryKind(entry: PipelineJournalEntry): boolean {
  const kind = entry.data?.kind;
  return typeof kind === 'string' && ADVISORY_FOLLOWUP_KINDS.includes(kind);
}

/** The latest feedback.delivered / feedback.undelivered entry per advisory dedupKey, oldest first. */
export function advisoryCandidates(entries: readonly PipelineJournalEntry[]): PipelineJournalEntry[] {
  const latest = new Map<string, PipelineJournalEntry>();
  for (const entry of entries) {
    if (!CANDIDATE_TYPES.has(entry.type) || !isAdvisoryKind(entry)) continue;
    const key = dedupKeyOf(entry);
    if (!key) continue;
    latest.delete(key);
    latest.set(key, entry);
  }
  return [...latest.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Which terminal follow-up entry, if any, closes the key. `filed` wins over `failed`. */
export function closingOutcomeFor(entries: readonly PipelineJournalEntry[], dedupKey: string): 'already-filed' | 'already-failed' | null {
  let failed = false;
  for (const entry of entries) {
    if (entry.data?.dedupKey !== dedupKey) continue;
    if (entry.type === 'feedback.followup_filed') return 'already-filed';
    if (entry.type === 'feedback.followup_failed') failed = true;
  }
  return failed ? 'already-failed' : null;
}

/** True when the journal holds feedback.followup_filed or feedback.followup_failed for the key. */
export function isAdvisoryCandidateClosed(entries: readonly PipelineJournalEntry[], dedupKey: string): boolean {
  return closingOutcomeFor(entries, dedupKey) !== null;
}

/** The candidate's data when it carries what a follow-up needs; null for an entry written before PAN-5218. */
export function advisoryDeliveryData(candidate: PipelineJournalEntry): AdvisoryDeliveryData | null {
  const data = candidate.data;
  if (!data || !Array.isArray(data.threads) || typeof data.repo !== 'string' || typeof data.prNumber !== 'number') return null;
  return data as unknown as AdvisoryDeliveryData;
}

/** Thread ids named in a re-review note's `CodeRabbit <thread ids>:` segments. */
export function threadIdsNamedInNote(note: string): Set<number> {
  const ids = new Set<number>();
  for (const match of note.matchAll(/CodeRabbit\s+([#\d][#\d,\s]*):/gi)) {
    for (const token of match[1].match(/\d+/g) ?? []) ids.add(Number(token));
  }
  return ids;
}

function later(at: string, than: number): boolean {
  const value = Date.parse(at);
  return Number.isFinite(value) && value > than;
}

/** The truth table, for one candidate. */
export function settleAdvisoryDelivery(
  candidate: PipelineJournalEntry,
  entries: readonly PipelineJournalEntry[],
  facts: PullRequestSettlementFacts,
): AdvisorySettlement {
  const dedupKey = dedupKeyOf(candidate) ?? '';
  const closed = closingOutcomeFor(entries, dedupKey);
  if (closed) return { outcome: closed, dedupKey };
  const data = advisoryDeliveryData(candidate);
  if (!data) return { outcome: 'legacy', dedupKey };

  const deliveredAt = Date.parse(candidate.at);
  const replied = new Set(facts.repliedThreadIds ?? []);
  const changedFiles = new Set<string>();
  for (const commit of facts.commits ?? []) {
    if (!later(commit.committedAt, deliveredAt)) continue;
    for (const file of commit.files ?? []) changedFiles.add(file);
  }
  const named = new Set<number>();
  for (const entry of entries) {
    if (entry.type !== 'review.requested' || !later(entry.at, deliveredAt)) continue;
    const note = entry.data?.note;
    if (typeof note === 'string') for (const id of threadIdsNamedInNote(note)) named.add(id);
  }

  const unsettled = data.threads.filter((thread) =>
    !replied.has(thread.id)
    && !(thread.path && changedFiles.has(thread.path))
    && !named.has(thread.id));
  if (unsettled.length === 0) return { outcome: 'settled', dedupKey };
  return { outcome: 'unsettled', dedupKey, at: candidate.at, data, threads: unsettled };
}
