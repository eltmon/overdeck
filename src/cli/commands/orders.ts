import type { OrderBook, OrderBookLane } from '@overdeck/contracts';
import chalk from 'chalk';
import { Command, InvalidArgumentError } from 'commander';

import { getBook, listBooks } from '../../lib/orders/resolver.js';
import {
  addItems,
  createBook,
  moveItem,
  removeItem,
  setStatus,
  type NewOrderBookItem,
} from '../../lib/orders/writer.js';
import { findProjectByPathSync, getProjectSync, resolveProjectPath, type ProjectConfig } from '../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../lib/state-read-home.js';

interface OrdersCommandDeps {
  cwd?: string;
  stateRoot?: string;
  projectKey?: string;
  now?: () => Date;
  actor?: string;
  startOrderBook?: (bookId: string) => Promise<{ runId: string }>;
}

interface OrdersAddOptions {
  lane?: OrderBookLane;
  after?: string;
  reverify?: boolean;
  project?: string;
}

interface OrdersMoveOptions {
  lane?: OrderBookLane;
  order?: number;
  project?: string;
}

interface OrdersProjectResolution {
  stateRoot: string;
  projectConfig?: ProjectConfig;
}

function resolveOrdersProject(deps: OrdersCommandDeps = {}): OrdersProjectResolution {
  if (deps.stateRoot) return { stateRoot: deps.stateRoot };
  if (deps.projectKey !== undefined) {
    const project = getProjectSync(deps.projectKey);
    if (!project) throw new Error(`Unknown project: ${deps.projectKey}`);
    return { stateRoot: resolveStateReadHomeSync(project, deps.projectKey).root, projectConfig: project };
  }
  const cwd = deps.cwd ?? process.cwd();
  const project = findProjectByPathSync(cwd);
  if (!project) throw new Error(`No configured project contains ${cwd}`);
  return { stateRoot: resolveStateReadHomeSync(project).root, projectConfig: project };
}

function stateRootFor(deps: OrdersCommandDeps = {}): string {
  return resolveOrdersProject(deps).stateRoot;
}

function requireBook(stateRoot: string, bookId: string): OrderBook {
  const book = getBook(stateRoot, bookId);
  if (!book) throw new Error(`Order book not found: ${bookId}`);
  return book;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'order-book';
}

function nextBookId(stateRoot: string, name: string, now: Date): string {
  const base = `${now.toISOString().slice(0, 10)}-${slugify(name)}`;
  if (!getBook(stateRoot, base)) return base;
  let suffix = 2;
  while (getBook(stateRoot, `${base}-${suffix}`)) suffix += 1;
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

export function formatBook(book: OrderBook): string {
  return JSON.stringify(book, null, 2);
}

export function formatBookList(books: readonly OrderBook[]): string {
  if (books.length === 0) return 'No order books found.';
  const rows = books.map((book) => [
    book.id,
    book.status,
    String(book.items.length),
    book.name,
  ]);
  const headers = ['ID', 'Status', 'Items', 'Name'];
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
  const stateRoot = stateRootFor(deps);
  return createBook(stateRoot, {
    id: nextBookId(stateRoot, trimmed, (deps.now ?? (() => new Date()))()),
    name: trimmed,
  });
}

export function runOrdersList(deps: OrdersCommandDeps = {}): OrderBook[] {
  return listBooks(stateRootFor(deps));
}

export function runOrdersShow(bookId: string, deps: OrdersCommandDeps = {}): OrderBook {
  return requireBook(stateRootFor(deps), bookId);
}

export async function runOrdersAdd(
  bookId: string,
  issueIds: readonly string[],
  options: OrdersAddOptions = {},
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  if (issueIds.length === 0) throw new Error('At least one issue is required');
  const stateRoot = stateRootFor(deps);
  const book = requireBook(stateRoot, bookId);
  const targetLane = options.lane ?? 'A';
  const actor = deps.actor ?? process.env['OVERDECK_AGENT_ID'] ?? 'operator';
  const laneItems = book.items
    .filter((item) => item.lane === targetLane)
    .sort((left, right) => left.order - right.order);
  let targetOrder = laneItems.length + 1;
  if (options.after) {
    const anchor = book.items.find((item) => item.issue.toUpperCase() === options.after!.toUpperCase());
    if (!anchor) throw new Error(`Issue ${options.after.toUpperCase()} is not in order book ${bookId}`);
    if (anchor.lane !== targetLane) {
      throw new Error(`Issue ${anchor.issue} is in Lane ${anchor.lane}; --after must name an item in Lane ${targetLane}`);
    }
    targetOrder = anchor.order + 1;
  }

  const additions: NewOrderBookItem[] = issueIds.map((issue, index) => ({
    issue: issue.toUpperCase(),
    lane: targetLane,
    order: targetOrder + index,
    prereqs: [],
    reVerify: options.reverify ?? false,
  }));
  let updated = await addItems(stateRoot, bookId, additions, actor);
  if (options.after) {
    for (const [index, issue] of issueIds.entries()) {
      updated = await moveItem(stateRoot, bookId, issue, targetLane, targetOrder + index);
    }
  }
  return updated;
}

export async function runOrdersRemove(
  bookId: string,
  issueId: string,
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  return removeItem(stateRootFor(deps), bookId, issueId);
}

export async function runOrdersMove(
  bookId: string,
  issueId: string,
  options: OrdersMoveOptions,
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  const stateRoot = stateRootFor(deps);
  const book = requireBook(stateRoot, bookId);
  const item = book.items.find((candidate) => candidate.issue.toUpperCase() === issueId.toUpperCase());
  if (!item) throw new Error(`Issue ${issueId.toUpperCase()} is not in order book ${bookId}`);
  if (options.lane === undefined && options.order === undefined) {
    throw new Error('--lane or --order is required');
  }
  return moveItem(
    stateRoot,
    bookId,
    issueId,
    options.lane ?? item.lane,
    options.order ?? item.order,
  );
}

export async function runOrdersStart(bookId: string, deps: OrdersCommandDeps = {}): Promise<{ runId: string }> {
  const resolved = resolveOrdersProject(deps);
  requireBook(resolved.stateRoot, bookId);
  return (deps.startOrderBook ?? ((id: string) => defaultStartOrderBook(id, resolved.projectConfig)))(bookId);
}

export async function runOrdersQueue(bookId: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const stateRoot = stateRootFor(deps);
  const book = requireBook(stateRoot, bookId);
  if (book.status !== 'draft') throw new Error(`Order book ${bookId} must be draft before it can be queued`);
  return setStatus(stateRoot, bookId, 'ready');
}

async function commandAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
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
    .action((options: { project?: string }) => commandAction(async () => {
      console.log(formatBookList(runOrdersList({ projectKey: options.project })));
    }));

  orders
    .command('show <id>')
    .description('Show an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(runOrdersShow(id, { projectKey: options.project })));
    }));

  orders
    .command('add <id> <issues...>')
    .description('Add issues to an order book')
    .option('--lane <lane>', 'Target lane: A or B', parseLane, 'A')
    .option('--after <issue>', 'Insert after an issue in the target lane')
    .option('--reverify', 'Require PRD re-verification before pickup')
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
    .command('start <id>')
    .description('Start a Flywheel run bound to an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      const result = await runOrdersStart(id, { projectKey: options.project });
      console.log(`Flywheel started: ${result.runId}`);
      console.log(`Order book: ${id}`);
    }));

  return orders;
}
