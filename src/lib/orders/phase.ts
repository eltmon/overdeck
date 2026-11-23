/**
 * Derived order-book phase (PAN-5597, PAN-5599).
 *
 * The page and the CLI need one truthful answer to "which book is live". It
 * comes from the same rule dispatch uses (`currentOrderBook`), derived on every
 * read and never stored: the stored statuses stay `draft`, `ready` and
 * `complete`, and the phase, queue position and "finished" flag are computed
 * from them plus the book's progress. A ready book whose issues are all
 * terminal (`isBookFinished`) is skipped when picking the active book, so a
 * finished book no longer blocks the next one from starting; a running book
 * stays active even when finished.
 *
 * Imports only types from `@overdeck/contracts` — never from `src/lib/cloister/`
 * or `src/lib/orders/resolver.ts` — so `lint:circular` stays clean.
 */
import type { OrderBook } from '@overdeck/contracts';

/** Every issue in the book is terminal and the book has at least one issue. */
export function isBookFinished(progress: { total: number; drained: boolean }): boolean {
  return progress.total > 0 && progress.drained;
}

/**
 * The book in flight: the running one, or the next ready book that isn't
 * finished. `isFinished` defaults to never-finished, so the running-or-first-
 * ready result is unchanged when the caller doesn't pass it.
 */
export function currentOrderBook(
  books: readonly OrderBook[],
  isFinished: (book: OrderBook) => boolean = () => false,
): OrderBook | null {
  return books.find(book => book.status === 'running')
    ?? books.find(book => book.status === 'ready' && !isFinished(book))
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
  const progressById = new Map(books.map(book => [book.id, progressOf(book)] as const));
  const finishedOf = (book: OrderBook) => isBookFinished(progressById.get(book.id)!);

  const active = currentOrderBook(books, finishedOf);
  const inQueue = books.filter(book => book.status !== 'draft' && book.status !== 'complete');
  const numbered = inQueue.filter(book => book === active || !finishedOf(book));
  const queueOrder = active ? [active, ...numbered.filter(book => book !== active)] : numbered;

  const views = new Map<string, OrderBookPhaseView>();
  for (const book of books) {
    const finished = finishedOf(book);
    if (book.status === 'complete') {
      views.set(book.id, { phase: 'archived', queuePosition: null, finished });
    } else if (book.status === 'draft') {
      views.set(book.id, { phase: 'draft', queuePosition: null, finished });
    } else {
      const position = queueOrder.indexOf(book);
      views.set(book.id, {
        phase: book === active ? 'active' : 'queued',
        queuePosition: position === -1 ? null : position + 1,
        finished,
      });
    }
  }
  return views;
}
