import type {
  OrderBook,
  OrderBookItem,
  OrderBookLane,
  OrderBookSettings,
  OrderBookStatus,
} from '@overdeck/contracts';
import { getBook, listBooks, membership } from './resolver.js';
import { readOrderBookIndex, writeOrderBookState } from './io.js';

export interface CreateOrderBookInput {
  id: string;
  name: string;
  settings?: Partial<OrderBookSettings>;
  createdAt?: string;
}

export type NewOrderBookItem = Omit<OrderBookItem, 'addedAt' | 'addedBy'> &
  Partial<Pick<OrderBookItem, 'addedAt' | 'addedBy'>>;

function timestamp(value?: string): string {
  return value ?? new Date().toISOString();
}

function requireBook(stateRoot: string, bookId: string): OrderBook {
  const book = getBook(stateRoot, bookId);
  if (!book) throw new Error(`Order book not found: ${bookId}`);
  return book;
}

function normalizeLaneOrder(items: readonly OrderBookItem[]): OrderBookItem[] {
  const laneA = items.filter((item) => item.lane === 'A').sort((a, b) => a.order - b.order);
  const laneB = items.filter((item) => item.lane === 'B').sort((a, b) => a.order - b.order);
  return [...laneA.map((item, index) => ({ ...item, order: index + 1 })), ...laneB.map((item, index) => ({ ...item, order: index + 1 }))];
}

function updated(book: OrderBook, changes: Partial<OrderBook>, at?: string): OrderBook {
  return { ...book, ...changes, id: book.id, createdAt: book.createdAt, updatedAt: timestamp(at) };
}

/** The sole order-book write door. */
export async function createBook(
  stateRoot: string,
  input: CreateOrderBookInput,
): Promise<OrderBook> {
  if (getBook(stateRoot, input.id)) throw new Error(`Order book already exists: ${input.id}`);
  const at = timestamp(input.createdAt);
  const settings: OrderBookSettings = {
    laneAConcurrency: input.settings?.laneAConcurrency ?? 1,
    briefOverlay: input.settings?.briefOverlay,
    posture: input.settings?.posture ?? 'open',
    postureSetAt: input.settings?.postureSetAt,
    postureSetBy: input.settings?.postureSetBy,
    postureReason: input.settings?.postureReason,
  };
  if (!Number.isInteger(settings.laneAConcurrency) || settings.laneAConcurrency < 1) {
    throw new Error('laneAConcurrency must be a positive integer');
  }
  return writeOrderBookState(stateRoot, {
    id: input.id,
    name: input.name,
    status: 'draft',
    settings,
    items: [],
    createdAt: at,
    updatedAt: at,
  });
}

export async function renameBook(
  stateRoot: string,
  bookId: string,
  name: string,
  at?: string,
): Promise<OrderBook> {
  if (!name.trim()) throw new Error('Order book name cannot be empty');
  const book = requireBook(stateRoot, bookId);
  return writeOrderBookState(stateRoot, updated(book, { name: name.trim() }, at));
}

export async function addItems(
  stateRoot: string,
  bookId: string,
  items: readonly NewOrderBookItem[],
  actor: string,
  at?: string,
): Promise<OrderBook> {
  const book = requireBook(stateRoot, bookId);
  const existing = new Set(book.items.map((item) => item.issue.toUpperCase()));
  const assigned = membership(stateRoot);
  const addedAt = timestamp(at);
  const additions: OrderBookItem[] = [];
  for (const item of items) {
    const issue = item.issue.toUpperCase();
    if (existing.has(issue) || additions.some((candidate) => candidate.issue.toUpperCase() === issue)) {
      throw new Error(`Issue ${issue} is already in order book ${bookId}`);
    }
    const otherBook = assigned.get(issue);
    if (otherBook && otherBook !== bookId) {
      throw new Error(`Issue ${issue} already belongs to non-complete order book ${otherBook}`);
    }
    additions.push({
      ...item,
      issue,
      prereqs: item.prereqs.map((prereq) => prereq.toUpperCase()),
      addedAt: item.addedAt ?? addedAt,
      addedBy: item.addedBy ?? actor,
    });
  }
  const nextItems = normalizeLaneOrder([...book.items, ...additions]);
  return writeOrderBookState(stateRoot, updated(book, { items: nextItems }, at));
}

export async function removeItem(
  stateRoot: string,
  bookId: string,
  issueId: string,
  at?: string,
): Promise<OrderBook> {
  const book = requireBook(stateRoot, bookId);
  const issue = issueId.toUpperCase();
  if (!book.items.some((item) => item.issue.toUpperCase() === issue)) {
    throw new Error(`Issue ${issue} is not in order book ${bookId}`);
  }
  const items = normalizeLaneOrder(book.items.filter((item) => item.issue.toUpperCase() !== issue));
  return writeOrderBookState(stateRoot, updated(book, { items }, at));
}

export async function moveItem(
  stateRoot: string,
  bookId: string,
  issueId: string,
  lane: OrderBookLane,
  order: number,
  at?: string,
): Promise<OrderBook> {
  const book = requireBook(stateRoot, bookId);
  const issue = issueId.toUpperCase();
  const moving = book.items.find((item) => item.issue.toUpperCase() === issue);
  if (!moving) throw new Error(`Issue ${issue} is not in order book ${bookId}`);
  if (!Number.isInteger(order) || order < 1) throw new Error('Order must be a positive integer');

  const remaining = book.items.filter((item) => item !== moving);
  const targetLane = remaining.filter((item) => item.lane === lane).sort((a, b) => a.order - b.order);
  targetLane.splice(Math.min(order - 1, targetLane.length), 0, { ...moving, lane, order });
  const otherLane = remaining.filter((item) => item.lane !== lane).sort((a, b) => a.order - b.order);
  const items = normalizeLaneOrder([...targetLane, ...otherLane]);
  return writeOrderBookState(stateRoot, updated(book, { items }, at));
}

export async function setItemRequirements(
  stateRoot: string,
  bookId: string,
  issueId: string,
  requirements: { prereqs?: readonly string[]; reVerify?: boolean; planAtPickup?: boolean },
  at?: string,
): Promise<OrderBook> {
  const book = requireBook(stateRoot, bookId);
  const issue = issueId.toUpperCase();
  let found = false;
  const items = book.items.map((item) => {
    if (item.issue.toUpperCase() !== issue) return item;
    found = true;
    return {
      ...item,
      prereqs: requirements.prereqs === undefined
        ? item.prereqs
        : [...new Set(requirements.prereqs.map((prereq) => prereq.toUpperCase()))],
      reVerify: requirements.reVerify ?? item.reVerify,
      planAtPickup: requirements.planAtPickup ?? item.planAtPickup,
    };
  });
  if (!found) throw new Error(`Issue ${issue} is not in order book ${bookId}`);
  return writeOrderBookState(stateRoot, updated(book, { items }, at));
}

export async function setSettings(
  stateRoot: string,
  bookId: string,
  settings: Partial<OrderBookSettings>,
  at?: string,
): Promise<OrderBook> {
  const book = requireBook(stateRoot, bookId);
  const next = { ...book.settings, ...settings };
  if (!Number.isInteger(next.laneAConcurrency) || next.laneAConcurrency < 1) {
    throw new Error('laneAConcurrency must be a positive integer');
  }
  return writeOrderBookState(stateRoot, updated(book, { settings: next }, at));
}

export async function setStatus(
  stateRoot: string,
  bookId: string,
  status: OrderBookStatus,
  options: { runId?: string | null; at?: string } = {},
): Promise<OrderBook> {
  const book = requireBook(stateRoot, bookId);
  if (status === 'running') {
    const running = listBooks(stateRoot).find((candidate) => candidate.status === 'running' && candidate.id !== bookId);
    if (running) throw new Error(`Order book ${running.id} is already running`);
  }
  const runId = options.runId === undefined ? book.runId : options.runId ?? undefined;
  return writeOrderBookState(stateRoot, updated(book, { status, runId }, options.at));
}

export async function advanceQueue(
  stateRoot: string,
  completedBookId: string,
  at?: string,
): Promise<OrderBook | null> {
  const current = requireBook(stateRoot, completedBookId);
  if (current.status !== 'complete') {
    await setStatus(stateRoot, completedBookId, 'complete', { at });
  }
  const order = readOrderBookIndex(stateRoot).map((entry) => entry.id);
  for (const id of order) {
    const book = getBook(stateRoot, id);
    if (book?.status === 'ready') return book;
  }
  return null;
}
