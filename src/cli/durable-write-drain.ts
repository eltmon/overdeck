import { Effect } from 'effect';
import { flushReviewStatusJournalWrites } from '../lib/overdeck/review-status-record-sync.js';
import { flushAllPendingAutoCommits } from '../lib/pan-dir/auto-commit.js';

/**
 * Drain process-local durable writes before a short-lived CLI exits.
 *
 * Journal writes run first because completing one can enqueue a state-worktree
 * auto-commit. Draining in the opposite order can still strand that commit.
 */
export async function drainPendingDurableWrites(): Promise<void> {
  await flushReviewStatusJournalWrites();
  await Effect.runPromise(flushAllPendingAutoCommits());
}
