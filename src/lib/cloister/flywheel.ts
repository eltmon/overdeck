/**
 * The flywheel's order books (PAN-3917 D12).
 *
 * This module used to own the flywheel run: spawn, pause, resume, abort, the
 * cohort computation, the devcontainer runtime probe, the resume contract, and
 * the run-record reads that tied them together. D12 deletes all of it — the
 * flywheel is a loop skill now, and `pan flywheel start` launches a
 * conversation running it. Run records, telemetry, substrate-bug weights and
 * the FlywheelPage go with it.
 *
 * What stays is the one thing other code still asks this module: which issues
 * the current order book covers. It is derived — the book comes from the repo's
 * `.pan/orders/` queue, not from a stored run. (`isIssueInResolvedPipeline`
 * went with the cohort code that was its only caller; the cloister's pipeline
 * membership consumer is `merge-eligibility.ts`.)
 */
import { resolvePlanHome } from '../pan-dir/paths.js';
import type { OrderBook } from '@overdeck/contracts';

import { listBooks } from '../orders/resolver.js';

export interface ActiveOrderBookIssuesDeps {
  planHome?: (projectRoot: string) => string | null;
  listBooks?: typeof listBooks;
}

/** The book in flight: the running one, or the next one queued up ready. */
export function currentOrderBook(books: readonly OrderBook[]): OrderBook | null {
  return books.find(book => book.status === 'running')
    ?? books.find(book => book.status === 'ready')
    ?? null;
}

/**
 * The issues in the project's current order book.
 *
 * The book used to be named by the active run's launch metadata. With run
 * records deleted the queue answers it directly: the running book, or the next
 * ready one. No run id, no stored pointer. A draft book is never the current
 * one — drafts are not dispatchable, which is the whole reason callers ask.
 */
export async function activeOrderBookIssues(
  projectRoot: string,
  deps: ActiveOrderBookIssuesDeps = {},
): Promise<ReadonlySet<string>> {
  // PAN-3917: order books live in the repo's plan home, not a state worktree.
  const planHome = deps.planHome?.(projectRoot) ?? resolvePlanHome(projectRoot);
  if (!planHome) return new Set();
  const book = currentOrderBook((deps.listBooks ?? listBooks)(planHome));
  return new Set(book?.items.map((item) => item.issue.toUpperCase()) ?? []);
}
