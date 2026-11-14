/**
 * The recent merges strip (PAN-4753 WI-7, FR-16, R8): a project's last five
 * merges and how each landed, including merges made outside the train.
 *
 * Derived, never stored. The merged PRs come from the cached forge listings;
 * attribution reads records that already exist:
 *   1. a promoted batch whose promote time is within 10 minutes of the PR's
 *      merge groups its members into one `batch` entry;
 *   2. the issue's newest `pending_auto_merges` row for that PR, `merged` =>
 *      `auto-merge`;
 *   3. a `merge.attempted` journal entry in the 30 minutes before the merge
 *      (feature or strike workspace) => `overdeck` (an operator merge door);
 *   4. otherwise `outside-train`. When an auto-merge was still scheduled for
 *      that PR, the entry carries a warning. Nothing is refused or reverted.
 */
import type { PendingAutoMerge, UatGeneration } from '../../../lib/overdeck/merge-types.js';
import type { PipelineJournalEntry } from '../../../lib/cloister/pipeline-journal.js';
import type { RecentMerge } from './merge-train-board-types.js';

/** One merged PR or MR, normalized across forges. */
export interface MergedPr {
  issueId: string;
  branch: string;
  url: string | null;
  mergedAt: string;
  /** Short merge commit sha, when the forge reported one. */
  sha: string | null;
}

export interface RecentMergesDeps {
  /** Merged feature/strike PRs of the project, any order. */
  listMerged: () => Promise<readonly MergedPr[]>;
  /** The project's `promoted` generations. */
  listPromoted: () => readonly UatGeneration[];
  /** The issue's newest auto-merge row. */
  latestAutoMerge: (issueId: string) => PendingAutoMerge | null;
  /** Journal entries of the issue's workspace for that branch (feature or strike). */
  journal: (issueId: string, branch: string) => readonly PipelineJournalEntry[];
}

const BATCH_WINDOW_MS = 10 * 60_000;
const OPERATOR_WINDOW_MS = 30 * 60_000;
const SOURCE_LIMIT = 20;
const RESULT_LIMIT = 5;

function ms(iso: string | null | undefined): number {
  const value = Date.parse(iso ?? '');
  return Number.isFinite(value) ? value : NaN;
}

/** When a promoted generation landed: its newest per-repo `promotedAt`, else `updatedAt` (C8). */
function promotedAtOf(gen: UatGeneration): number {
  const repoTimes = (gen.repos ?? []).map((repo) => ms(repo.promotedAt)).filter(Number.isFinite);
  return repoTimes.length > 0 ? Math.max(...repoTimes) : ms(gen.updatedAt);
}

function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.replace(/\/$/, '') === b.replace(/\/$/, '');
}

function outsideWarning(row: PendingAutoMerge | null, pr: MergedPr): string | undefined {
  if (!row || (row.prUrl && pr.url && !sameUrl(row.prUrl, pr.url))) return undefined;
  const scheduled = row.status === 'pending'
    || (row.status === 'blocked' && /already merged/i.test(row.failureReason ?? ''));
  if (!scheduled) return undefined;
  const early = ms(row.scheduledMergeAt) - ms(pr.mergedAt);
  if (Number.isFinite(early) && early > 0) {
    return `merged on the forge ${Math.ceil(early / 60_000)} min before its cooldown ended`;
  }
  return 'merged on the forge while its auto-merge was scheduled';
}

function attribute(pr: MergedPr, deps: RecentMergesDeps): RecentMerge {
  const row = deps.latestAutoMerge(pr.issueId);
  const base = { issueIds: [pr.issueId], sha: pr.sha, mergedAt: pr.mergedAt };
  if (row?.status === 'merged' && (!row.prUrl || !pr.url || sameUrl(row.prUrl, pr.url))) {
    return { ...base, via: 'auto-merge' };
  }
  const mergedMs = ms(pr.mergedAt);
  const operator = deps.journal(pr.issueId, pr.branch).some((entry) => {
    if (entry.type !== 'merge.attempted') return false;
    const before = mergedMs - ms(entry.at);
    return before >= 0 && before <= OPERATOR_WINDOW_MS;
  });
  if (operator) return { ...base, via: 'overdeck' };
  const warning = outsideWarning(row, pr);
  return { ...base, via: 'outside-train', ...(warning ? { warning } : {}) };
}

/** The project's newest five merges, newest first. Writes nothing. */
export async function recentMergesForProject(deps: RecentMergesDeps): Promise<RecentMerge[]> {
  const merged = [...await deps.listMerged()]
    .filter((pr) => Number.isFinite(ms(pr.mergedAt)))
    .sort((a, b) => ms(b.mergedAt) - ms(a.mergedAt))
    .slice(0, SOURCE_LIMIT);
  const promoted = deps.listPromoted();
  const claimed = new Set<string>();
  const entries: RecentMerge[] = [];

  for (const gen of promoted) {
    const at = promotedAtOf(gen);
    if (!Number.isFinite(at)) continue;
    const memberIds = new Set(gen.members.map((member) => member.issueId.toUpperCase()));
    const order = new Map(gen.members.map((member) => [member.issueId.toUpperCase(), member.mergeOrder]));
    // Listed in the batch's own merge order, not the forge's merge timestamps.
    const landed = merged
      .filter((pr) => memberIds.has(pr.issueId) && Math.abs(ms(pr.mergedAt) - at) <= BATCH_WINDOW_MS)
      .sort((a, b) => (order.get(a.issueId) ?? 0) - (order.get(b.issueId) ?? 0));
    if (landed.length === 0) continue;
    for (const pr of landed) claimed.add(`${pr.issueId}|${pr.mergedAt}`);
    const newest = landed.reduce((a, b) => (ms(a.mergedAt) >= ms(b.mergedAt) ? a : b));
    const mergeSha = (gen.repos ?? []).find((repo) => repo.mergeSha)?.mergeSha ?? null;
    entries.push({
      issueIds: landed.map((pr) => pr.issueId),
      sha: mergeSha ? mergeSha.slice(0, 7) : newest.sha,
      mergedAt: newest.mergedAt,
      via: 'batch',
      batchName: gen.name,
    });
  }

  for (const pr of merged) {
    if (claimed.has(`${pr.issueId}|${pr.mergedAt}`)) continue;
    entries.push(attribute(pr, deps));
  }

  return entries.sort((a, b) => ms(b.mergedAt) - ms(a.mergedAt)).slice(0, RESULT_LIMIT);
}
