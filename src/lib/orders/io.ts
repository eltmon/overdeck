import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { OrderBookIndexEntry as OrderBookIndexEntrySchema } from '@overdeck/contracts';
import type { OrderBook, OrderBookIndexEntry, OrderBookItem } from '@overdeck/contracts';
import { Effect, Schema } from 'effect';
import { flushAutoCommits, queueAutoCommit } from '../pan-dir/auto-commit.js';
import { parseOrderBookJson } from './types.js';

const BOOK_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const decodeIndex = Schema.decodeUnknownSync(Schema.Array(OrderBookIndexEntrySchema));

export function ordersDirectory(stateRoot: string): string {
  return join(stateRoot, 'orders');
}

export function orderBookPath(stateRoot: string, bookId: string): string {
  if (!BOOK_ID_PATTERN.test(bookId)) {
    throw new Error(`Invalid order book id: ${bookId}`);
  }
  return join(ordersDirectory(stateRoot), `${bookId}.json`);
}

export function orderBookIndexPath(stateRoot: string): string {
  return join(ordersDirectory(stateRoot), 'index.json');
}

export function backlogSequencePath(stateRoot: string): string {
  return join(stateRoot, 'backlog', 'sequence.md');
}

export async function readOrderBookAsync(stateRoot: string, bookId: string): Promise<OrderBook | null> {
  const path = orderBookPath(stateRoot, bookId);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Could not parse order book ${bookId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = parseOrderBookJson(value);
  if (!parsed.ok) throw new Error(`Could not parse order book ${bookId}: ${parsed.error}`);
  if (parsed.book.id !== bookId) throw new Error(`Order book ${bookId} contains mismatched id ${parsed.book.id}`);
  return parsed.book;
}

export function readOrderBook(stateRoot: string, bookId: string): OrderBook | null {
  const path = orderBookPath(stateRoot, bookId);
  if (!existsSync(path)) return null;

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not parse order book ${bookId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = parseOrderBookJson(value);
  if (!parsed.ok) throw new Error(`Could not parse order book ${bookId}: ${parsed.error}`);
  if (parsed.book.id !== bookId) {
    throw new Error(`Order book ${bookId} contains mismatched id ${parsed.book.id}`);
  }
  return parsed.book;
}

export function readOrderBookIndex(stateRoot: string): readonly OrderBookIndexEntry[] {
  const path = orderBookIndexPath(stateRoot);
  if (!existsSync(path)) return [];

  try {
    return decodeIndex(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    throw new Error(
      `Could not parse order book index: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function listOrderBookIds(stateRoot: string): string[] {
  const indexed = readOrderBookIndex(stateRoot).map((entry) => entry.id);
  if (indexed.length > 0 || !existsSync(ordersDirectory(stateRoot))) return [...indexed];

  return readdirSync(ordersDirectory(stateRoot))
    .filter((name) => name !== 'index.json' && name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => BOOK_ID_PATTERN.test(id))
    .sort();
}

function preserveOperatorOwnedState(prior: OrderBook | null, next: OrderBook): OrderBook {
  if (!prior) return next;
  if (prior.id !== next.id) {
    throw new Error(`Order book id is immutable: ${prior.id} cannot become ${next.id}`);
  }

  const priorItems = new Map(prior.items.map((item) => [item.issue.toUpperCase(), item]));
  const items = next.items.map((item): OrderBookItem => {
    const existing = priorItems.get(item.issue.toUpperCase());
    if (!existing) return item;
    return {
      ...item,
      addedAt: existing.addedAt,
      addedBy: existing.addedBy,
    };
  });

  return { ...next, createdAt: prior.createdAt, items };
}

function indexEntry(book: OrderBook): OrderBookIndexEntry {
  return {
    id: book.id,
    name: book.name,
    status: book.status,
    runId: book.runId,
    updatedAt: book.updatedAt,
  };
}

/**
 * Physical state-store primitive used only by the orders writer. Domain callers
 * must mutate order books through writer.ts so the book and queue stay aligned.
 */
export async function writeOrderBookState(
  stateRoot: string,
  nextBook: OrderBook,
  queueOrder?: readonly string[],
): Promise<OrderBook> {
  const prior = readOrderBook(stateRoot, nextBook.id);
  const book = preserveOperatorOwnedState(prior, nextBook);
  const bookPath = orderBookPath(stateRoot, book.id);
  const indexPath = orderBookIndexPath(stateRoot);
  const existingIndex = [...readOrderBookIndex(stateRoot)];
  const byId = new Map(existingIndex.map((entry) => [entry.id, entry]));
  byId.set(book.id, indexEntry(book));

  const requested = queueOrder ?? existingIndex.map((entry) => entry.id);
  const ids = [...requested];
  if (!ids.includes(book.id)) ids.push(book.id);
  for (const entry of existingIndex) {
    if (!ids.includes(entry.id)) ids.push(entry.id);
  }
  const index = ids.map((id) => byId.get(id)).filter((entry): entry is OrderBookIndexEntry => Boolean(entry));

  mkdirSync(dirname(bookPath), { recursive: true });
  writeFileSync(bookPath, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  queueAutoCommit({
    projectRoot: stateRoot,
    repoRoot: stateRoot,
    paths: [bookPath, indexPath],
    subject: `chore(state): update order book ${book.id}`,
  });
  const flushed = await Effect.runPromise(flushAutoCommits(stateRoot));
  if (flushed.errored || flushed.pushed === false) {
    throw new Error(`Failed to persist order book ${book.id}: ${flushed.reason ?? 'state commit failed'}`);
  }
  return book;
}
