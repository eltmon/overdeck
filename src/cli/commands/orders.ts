import type { OrderBook, OrderBookLane } from '@overdeck/contracts';
import { Command, InvalidArgumentError } from 'commander';

import { deriveBookPhases, type OrderBookPhaseView } from '../../lib/orders/phase.js';
import {
  computeBookProgress,
  ensureOrderIssueStore,
  getBookAsync,
  listBooks,
  liveOrderIssueLookup,
  normalizeOrderIssueId,
} from '../../lib/orders/resolver.js';
import type { OrderIssueLookup } from '../../lib/orders/types.js';
import {
  addItems,
  assertRestorable,
  createBook,
  moveItem,
  removeItem,
  setStatus,
  type NewOrderBookItem,
} from '../../lib/orders/writer.js';
import { resolveProjectPath, type ProjectConfig } from '../../lib/projects.js';
import {
  commandAction,
  commitOrders,
  formatBook,
  type OrdersCommandDeps,
  panDirFor,
  requireBook,
  resolveOrdersProject,
} from './orders-shared.js';
import { registerOrdersEditCommands } from './orders-edit.js';

export type { OrdersCommandDeps } from './orders-shared.js';
export { commandAction, commitOrders, formatBook, panDirFor, requireBook, resolveOrdersProject } from './orders-shared.js';

export interface OrdersListing {
  books: OrderBook[];
  phases: Map<string, OrderBookPhaseView>;
}

interface OrdersAddOptions {
  lane?: OrderBookLane;
  after?: string;
  reverify?: boolean;
  project?: string;
  prereqs?: string;
  planAtPickup?: boolean;
}

interface OrdersMoveOptions {
  lane?: OrderBookLane;
  order?: number;
  project?: string;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'order-book';
}

async function nextBookId(panDir: string, name: string, now: Date): Promise<string> {
  const base = `${now.toISOString().slice(0, 10)}-${slugify(name)}`;
  if (!await getBookAsync(panDir, base)) return base;
  let suffix = 2;
  while (await getBookAsync(panDir, `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function parseLane(value: string): OrderBookLane {
  const normalized = value.toUpperCase();
  if (normalized !== 'A' && normalized !== 'B') throw new InvalidArgumentError('must be A or B');
  return normalized;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new InvalidArgumentError('must be a positive integer');
  return parsed;
}

/** `active`, `queued #<n>`, `draft` or `archived`, with ` (finished)` when every issue is terminal. */
function phaseLabel(view: OrderBookPhaseView | undefined, book: OrderBook): string {
  if (!view) return book.status;
  const base = view.phase === 'queued' && view.queuePosition !== null ? `queued #${view.queuePosition}` : view.phase;
  return view.finished ? `${base} (finished)` : base;
}

export function formatBookList(books: readonly OrderBook[], phases: ReadonlyMap<string, OrderBookPhaseView>): string {
  if (books.length === 0) return 'No order books found.';
  const rows = books.map((book) => [
    book.id,
    phaseLabel(phases.get(book.id), book),
    String(book.items.length),
    book.name,
  ]);
  const headers = ['ID', 'Phase', 'Items', 'Name'];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => row[index]!.length),
  ));
  const formatRow = (values: string[]) => values
    .map((value, index) => value.padEnd(widths[index]!))
    .join('  ');
  return [
    formatRow(headers),
    formatRow(widths.map((width) => '-'.repeat(width))),
    ...rows.map(formatRow),
  ].join('\n');
}

async function defaultStartOrderBook(bookId: string, project?: ProjectConfig): Promise<{ runId: string }> {
  const { startFlywheelRun } = await import('./flywheel.js');
  return startFlywheelRun({ cwd: project ? resolveProjectPath(project) : undefined, orders: bookId });
}

export async function runOrdersCreate(name: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Order book name cannot be empty');
  const panDir = panDirFor(deps);
  const book = await createBook(panDir, {
    id: await nextBookId(panDir, trimmed, (deps.now ?? (() => new Date()))()),
    name: trimmed,
  });
  await commitOrders(panDir, `chore(orders): create order book ${book.id}`);
  return book;
}

export function runOrdersList(deps: OrdersCommandDeps = {}): OrdersListing {
  const books = listBooks(panDirFor(deps));
  // One issue-state read for every book, not one per book.
  const issueIds = [...new Set(books.flatMap((book) => book.items.map((item) => item.issue.toUpperCase())))];
  const state = (deps.issueLookup ?? liveOrderIssueLookup)(issueIds);
  const issueLookup: OrderIssueLookup = (requested) => new Map(requested.flatMap((issueId) => {
    const found = state.get(issueId.toUpperCase());
    return found ? [[issueId.toUpperCase(), found] as const] : [];
  }));
  return { books, phases: deriveBookPhases(books, (book) => computeBookProgress(book, issueLookup)) };
}

export async function runOrdersShow(bookId: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  return requireBook(panDirFor(deps), bookId);
}

export async function runOrdersAdd(
  bookId: string,
  issueIds: readonly string[],
  options: OrdersAddOptions = {},
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  if (issueIds.length === 0) throw new Error('At least one issue is required');
  const panDir = panDirFor(deps);
  const book = await requireBook(panDir, bookId);
  const targetLane = options.lane ?? 'A';
  const actor = deps.actor ?? process.env['OVERDECK_AGENT_ID'] ?? 'operator';
  const laneItems = book.items
    .filter((item) => item.lane === targetLane)
    .sort((left, right) => left.order - right.order);
  let targetOrder = laneItems.length + 1;
  if (options.after) {
    const anchorIssue = normalizeOrderIssueId(panDir, options.after).toUpperCase();
    const anchor = book.items.find((item) => item.issue.toUpperCase() === anchorIssue);
    if (!anchor) throw new Error(`Issue ${anchorIssue} is not in order book ${bookId}`);
    if (anchor.lane !== targetLane) {
      throw new Error(`Issue ${anchor.issue} is in Lane ${anchor.lane}; --after must name an item in Lane ${targetLane}`);
    }
    targetOrder = anchor.order + 1;
  }

  const prereqs = (options.prereqs ?? '')
    .split(',')
    .map((prereq) => prereq.trim())
    .filter((prereq) => prereq.length > 0)
    .map((prereq) => prereq.toUpperCase());
  const additions: NewOrderBookItem[] = issueIds.map((issue, index) => ({
    issue: issue.toUpperCase(),
    lane: targetLane,
    order: targetOrder + index,
    prereqs,
    reVerify: options.reverify ?? false,
    ...(options.planAtPickup ? { planAtPickup: true } : {}),
  }));
  let updated = await addItems(panDir, bookId, additions, actor);
  if (options.after) {
    for (const [index, issue] of issueIds.entries()) {
      updated = await moveItem(panDir, bookId, issue, targetLane, targetOrder + index);
    }
  }
  await commitOrders(panDir, `chore(orders): add ${issueIds.join(', ')} to ${bookId}`);
  return updated;
}

export async function runOrdersRemove(
  bookId: string,
  issueId: string,
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await removeItem(panDir, bookId, issueId);
  await commitOrders(panDir, `chore(orders): remove ${issueId.toUpperCase()} from ${bookId}`);
  return book;
}

export async function runOrdersMove(
  bookId: string,
  issueId: string,
  options: OrdersMoveOptions,
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await requireBook(panDir, bookId);
  const item = book.items.find((candidate) => candidate.issue.toUpperCase() === issueId.toUpperCase());
  if (!item) throw new Error(`Issue ${issueId.toUpperCase()} is not in order book ${bookId}`);
  if (options.lane === undefined && options.order === undefined) {
    throw new Error('--lane or --order is required');
  }
  const moved = await moveItem(
    panDir,
    bookId,
    issueId,
    options.lane ?? item.lane,
    options.order ?? item.order,
  );
  await commitOrders(panDir, `chore(orders): move ${issueId.toUpperCase()} in ${bookId}`);
  return moved;
}

export async function runOrdersStart(bookId: string, deps: OrdersCommandDeps = {}): Promise<{ runId: string }> {
  const resolved = resolveOrdersProject(deps);
  await requireBook(resolved.panDir, bookId);
  return (deps.startOrderBook ?? ((id: string) => defaultStartOrderBook(id, resolved.projectConfig)))(bookId);
}

export async function runOrdersQueue(bookId: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await requireBook(panDir, bookId);
  if (book.status !== 'draft') throw new Error(`Order book ${bookId} must be draft before it can be queued`);
  const queued = await setStatus(panDir, bookId, 'ready');
  await commitOrders(panDir, `chore(orders): queue order book ${bookId}`);
  return queued;
}

export async function runOrdersUnqueue(bookId: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await requireBook(panDir, bookId);
  if (book.status !== 'ready') throw new Error(`Order book ${bookId} must be queued before it can be moved back to draft`);
  const draft = await setStatus(panDir, bookId, 'draft');
  await commitOrders(panDir, `chore(orders): unqueue order book ${bookId}`);
  return draft;
}

export async function runOrdersArchive(bookId: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await requireBook(panDir, bookId);
  if (book.status !== 'draft' && book.status !== 'ready') {
    throw new Error(`Order book ${bookId} must be draft or queued before it can be archived`);
  }
  const archived = await setStatus(panDir, bookId, 'complete');
  await commitOrders(panDir, `chore(orders): archive order book ${bookId}`);
  return archived;
}

export async function runOrdersUnarchive(bookId: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await requireBook(panDir, bookId);
  if (book.status !== 'complete') throw new Error(`Order book ${bookId} must be archived before it can be restored`);
  assertRestorable(panDir, book);
  const restored = await setStatus(panDir, bookId, 'draft');
  await commitOrders(panDir, `chore(orders): unarchive order book ${bookId}`);
  return restored;
}

export function createOrdersCommand(): Command {
  const orders = new Command('orders')
    .description('Create and manage Flywheel order books');

  orders
    .command('create <name>')
    .description('Create a draft order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((name: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersCreate(name, { projectKey: options.project })));
    }));

  orders
    .command('list')
    .description('List order books')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .option('--json', 'Print the books as JSON')
    .action((options: { project?: string; json?: boolean }) => commandAction(async () => {
      // A CLI process has no running issue service; load the shared issue cache so the
      // Phase column can tell a finished book from an unfinished one.
      const panDir = panDirFor({ projectKey: options.project });
      await ensureOrderIssueStore().catch(() => undefined);
      const { books, phases } = runOrdersList({ panDir });
      console.log(options.json ? JSON.stringify(books, null, 2) : formatBookList(books, phases));
      // Starting the issue service schedules background refresh work that would keep this
      // one-shot read alive for seconds after the list is printed.
      process.exit(0);
    }));

  orders
    .command('show <id>')
    .description('Show an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .option('--json', 'Print JSON (the default)')
    .action((id: string, options: { project?: string; json?: boolean }) => commandAction(async () => {
      console.log(formatBook(await runOrdersShow(id, { projectKey: options.project })));
    }));

  orders
    .command('add <id> <issues...>')
    .description('Add issues to an order book')
    .option('--lane <lane>', 'Target lane: A or B', parseLane, 'A')
    .option('--after <issue>', 'Insert after an issue in the target lane')
    .option('--reverify', 'Require PRD re-verification before pickup')
    .option('--prereqs <issues>', 'Comma-separated issues that must land first')
    .option('--plan-at-pickup', 'Write the plan when the issue starts')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, issues: string[], options: OrdersAddOptions) => commandAction(async () => {
      console.log(formatBook(await runOrdersAdd(id, issues, options, { projectKey: options.project })));
    }));

  orders
    .command('remove <id> <issue>')
    .description('Remove an issue from an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, issue: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersRemove(id, issue, { projectKey: options.project })));
    }));

  orders
    .command('move <id> <issue>')
    .description('Move an issue within or between lanes')
    .option('--lane <lane>', 'Target lane: A or B', parseLane)
    .option('--order <n>', 'One-based position in the target lane', parsePositiveInteger)
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, issue: string, options: OrdersMoveOptions) => commandAction(async () => {
      console.log(formatBook(await runOrdersMove(id, issue, options, { projectKey: options.project })));
    }));

  orders
    .command('queue <id>')
    .description('Mark a draft order book ready for dispatch')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersQueue(id, { projectKey: options.project })));
    }));

  orders
    .command('unqueue <id>')
    .description('Move a queued order book back to draft')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersUnqueue(id, { projectKey: options.project })));
    }));

  orders
    .command('archive <id>')
    .description('Archive an order book and free its issues')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersArchive(id, { projectKey: options.project })));
    }));

  orders
    .command('unarchive <id>')
    .description('Restore an archived order book as a draft')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersUnarchive(id, { projectKey: options.project })));
    }));

  orders
    .command('start <id>')
    .description('Start a Flywheel run bound to an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      const result = await runOrdersStart(id, { projectKey: options.project });
      console.log(`Flywheel started: ${result.runId}`);
      console.log(`Order book: ${id}`);
    }));

  registerOrdersEditCommands(orders);

  return orders;
}
