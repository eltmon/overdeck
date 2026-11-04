/**
 * Whether a `pending_auto_merges` row lets the auto-merge scheduler write a
 * new one for a given PR head (PAN-3983, extracted from
 * `services/auto-merge-scheduler.ts` in PAN-4970).
 *
 * Pure and dependency-free so `services/merge-path-owner.ts` can read it
 * without creating an import cycle: `services/auto-merge-scheduler.ts`
 * reaches `routes/merge-train.ts` (for the schedule door), which reaches
 * `services/uat-train.ts`, which reaches `services/merge-path-owner.ts`;
 * this function living in the scheduler module would close that loop no
 * matter which edge used `await import(...)` — madge's TypeScript detective
 * counts dynamic imports as edges too. `auto-merge-scheduler.ts` re-exports
 * it so existing importers keep resolving it from there.
 */
import type { PendingAutoMerge } from '../overdeck/merge-sync.js';
import type { PrFacts } from './pr-facts.js';

/** True when two SHAs (full or abbreviated) name the same commit. */
function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Whether the issue's latest auto-merge row lets the scheduler write a new one
 * for this PR head. Asked only once the merge gate has passed.
 *
 *   - none, or `merged`: yes;
 *   - `pending` / `merging`: no, it is already scheduled;
 *   - `cancelled`: no, for the whole issue, whatever PR or head it now has. An
 *     operator's cancel means stop; only the operator re-schedules it (the
 *     schedule endpoint), which writes a newer row;
 *   - `blocked` / `failed` for another PR, or for this PR at another head: yes,
 *     the new push re-arms it;
 *   - `blocked` / `failed` without a recorded head (written before heads were
 *     tracked): no, a new head cannot be told apart from the old one;
 *   - the same head: `failed` (a merge was attempted) stays; `blocked` (the
 *     executor's pre-merge refusal) re-arms, because the gate passing now means
 *     the block's reason has cleared.
 */
export function latestAutoMergeAllowsSchedule(
  latest: PendingAutoMerge | null,
  pr: Pick<PrFacts, 'url' | 'headSha'>,
): boolean {
  if (!latest || latest.status === 'merged') return true;
  if (latest.status === 'pending' || latest.status === 'merging' || latest.status === 'cancelled') return false;
  const samePr = !pr.url || latest.prUrl.replace(/\/+$/, '').toLowerCase() === pr.url.replace(/\/+$/, '').toLowerCase();
  if (!samePr) return true;
  if (!latest.headSha) return false;
  if (pr.headSha && !sameCommit(latest.headSha, pr.headSha)) return true;
  return latest.status === 'blocked';
}
