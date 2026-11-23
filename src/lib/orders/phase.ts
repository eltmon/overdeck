/**
 * Derived order-book phase (PAN-5597).
 *
 * The page and the CLI need one truthful answer to "which book is live". It
 * comes from the same rule dispatch uses (`currentOrderBook`), derived on every
 * read and never stored: the stored statuses stay `draft`, `ready` and
 * `complete`, and the phase, queue position and "finished" flag are computed
 * from them plus the book's progress.
 *
 * Imports only types from `@overdeck/contracts` — never from `src/lib/cloister/`
 * or `src/lib/orders/resolver.ts` — so `lint:circular` stays clean.
 */
import type { OrderBook } from '@overdeck/contracts';

/** The book in flight: the running one, or the next one queued up ready. */
export function currentOrderBook(books: readonly OrderBook[]): OrderBook | null {
  return books.find(book => book.status === 'running')
    ?? books.find(book => book.status === 'ready')
    ?? null;
}

export type OrderBookPhase = 'draft' | 'active' | 'queued' | 'archived';

export interface OrderBookPhaseView {
  phase: OrderBookPhase;
  /** 1-based place among books with status running or ready, in index order. Null for draft and archived. */
  queuePosition: number | null;
  /** Every issue is terminal and the book has at least one issue. */
  finished: boolean;
}

/**
 * Derive each book's phase, queue position and finished flag.
 *
 * `books` must be in index order (`listBooks` order). The active book is the one
 * `currentOrderBook` returns; it takes queue position 1 and the other queued
 * books follow in index order.
 */
export function deriveBookPhases(
  books: readonly OrderBook[],
  progressOf: (book: OrderBook) => { total: number; drained: boolean },
): Map<string, OrderBookPhaseView> {
  const active = currentOrderBook(books);
  const inQueue = books.filter(book => book.status !== 'draft' && book.status !== 'complete');
  const queueOrder = active ? [active, ...inQueue.filter(book => book !== active)] : inQueue;

  const views = new Map<string, OrderBookPhaseView>();
  for (const book of books) {
    const progress = progressOf(book);
    const finished = progress.total > 0 && progress.drained;
    if (book.status === 'complete') {
      views.set(book.id, { phase: 'archived', queuePosition: null, finished });
    } else if (book.status === 'draft') {
      views.set(book.id, { phase: 'draft', queuePosition: null, finished });
    } else {
      views.set(book.id, {
        phase: book === active ? 'active' : 'queued',
        queuePosition: queueOrder.indexOf(book) + 1,
        finished,
      });
    }
  }
  return views;
}
