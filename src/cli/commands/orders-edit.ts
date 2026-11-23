/**
 * PAN-5598 WI-7/WI-8/WI-9: the `pan orders` verbs beyond create/list/show/
 * add/remove/move/queue/start, in a separate file so this branch and
 * PAN-5597 do not edit the same lines of orders.ts.
 */
import type { OrderBook } from '@overdeck/contracts';
import { Command, InvalidArgumentError } from 'commander';

import { renameBook, setItemRequirements, setSettings } from '../../lib/orders/writer.js';
import { commandAction, commitOrders, formatBook, type OrdersCommandDeps, panDirFor } from './orders.js';

interface OrdersSetOptions {
  parallel?: number;
  brief?: string | false;
  project?: string;
}

interface OrdersPostureOptions {
  reason?: string;
  project?: string;
}

interface OrdersItemOptions {
  prereqs?: string;
  reverify?: boolean;
  planAtPickup?: boolean;
  project?: string;
}

function parseParallel(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) throw new InvalidArgumentError('must be an integer from 1 to 8');
  return parsed;
}

export async function runOrdersRename(bookId: string, name: string, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const book = await renameBook(panDir, bookId, name);
  await commitOrders(panDir, `chore(orders): rename order book ${bookId}`);
  return book;
}

export async function runOrdersSet(bookId: string, options: OrdersSetOptions, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  if (options.parallel === undefined && options.brief === undefined) {
    throw new Error('--parallel, --brief or --no-brief is required');
  }
  if (options.parallel !== undefined && (!Number.isInteger(options.parallel) || options.parallel < 1 || options.parallel > 8)) {
    throw new Error('--parallel must be an integer from 1 to 8');
  }
  if (typeof options.brief === 'string' && !options.brief.endsWith('.md')) {
    throw new Error('--brief must be a .md path');
  }
  const panDir = panDirFor(deps);
  const patch: { laneAConcurrency?: number; briefOverlay?: string } = {};
  if (options.parallel !== undefined) patch.laneAConcurrency = options.parallel;
  if (options.brief !== undefined) patch.briefOverlay = options.brief === false ? '' : options.brief;
  const book = await setSettings(panDir, bookId, patch);
  await commitOrders(panDir, `chore(orders): update settings of ${bookId}`);
  return book;
}

async function runOrdersPosture(
  bookId: string,
  posture: 'open' | 'drain',
  defaultReason: string,
  options: OrdersPostureOptions,
  deps: OrdersCommandDeps,
  subject: string,
): Promise<OrderBook> {
  const panDir = panDirFor(deps);
  const postureSetAt = (deps.now ?? (() => new Date()))().toISOString();
  const book = await setSettings(panDir, bookId, {
    posture,
    postureReason: options.reason ?? defaultReason,
    postureSetAt,
    postureSetBy: 'cli',
  });
  await commitOrders(panDir, subject);
  return book;
}

export async function runOrdersPause(bookId: string, options: OrdersPostureOptions, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  return runOrdersPosture(bookId, 'drain', 'Operator paused new pickup.', options, deps, `chore(orders): pause pickup for ${bookId}`);
}

export async function runOrdersResume(bookId: string, options: OrdersPostureOptions, deps: OrdersCommandDeps = {}): Promise<OrderBook> {
  return runOrdersPosture(bookId, 'open', 'Operator reopened pickup.', options, deps, `chore(orders): resume pickup for ${bookId}`);
}

export async function runOrdersItem(
  bookId: string,
  issueId: string,
  options: OrdersItemOptions,
  deps: OrdersCommandDeps = {},
): Promise<OrderBook> {
  if (options.prereqs === undefined && options.reverify === undefined && options.planAtPickup === undefined) {
    throw new Error('--prereqs, --reverify, --no-reverify, --plan-at-pickup or --no-plan-at-pickup is required');
  }
  const panDir = panDirFor(deps);
  const requirements: { prereqs?: readonly string[]; reVerify?: boolean; planAtPickup?: boolean } = {};
  if (options.prereqs !== undefined) {
    requirements.prereqs = options.prereqs
      .split(',')
      .map((prereq) => prereq.trim())
      .filter((prereq) => prereq.length > 0)
      .map((prereq) => prereq.toUpperCase());
  }
  if (options.reverify !== undefined) requirements.reVerify = options.reverify;
  if (options.planAtPickup !== undefined) requirements.planAtPickup = options.planAtPickup;
  const book = await setItemRequirements(panDir, bookId, issueId, requirements);
  await commitOrders(panDir, `chore(orders): update ${issueId.toUpperCase()} in ${bookId}`);
  return book;
}

export function registerOrdersEditCommands(orders: Command): void {
  orders
    .command('rename <id> <name>')
    .description('Rename an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, name: string, options: { project?: string }) => commandAction(async () => {
      console.log(formatBook(await runOrdersRename(id, name, { projectKey: options.project })));
    }));

  orders
    .command('set <id>')
    .description('Change an order book\'s parallel limit or extra instructions file')
    .option('--parallel <n>', 'How many lane A issues run at once (1-8)', parseParallel)
    .option('--brief <path>', 'A repo-relative .md path added to every issue\'s kickoff brief')
    .option('--no-brief', 'Clear the extra instructions file')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: OrdersSetOptions) => commandAction(async () => {
      console.log(formatBook(await runOrdersSet(id, options, { projectKey: options.project })));
    }));

  orders
    .command('pause <id>')
    .description('Pause new pickup for an order book')
    .option('--reason <text>', 'Why pickup is paused')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: OrdersPostureOptions) => commandAction(async () => {
      console.log(formatBook(await runOrdersPause(id, options, { projectKey: options.project })));
    }));

  orders
    .command('resume <id>')
    .description('Resume pickup for an order book')
    .option('--reason <text>', 'Why pickup is resumed')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: OrdersPostureOptions) => commandAction(async () => {
      console.log(formatBook(await runOrdersResume(id, options, { projectKey: options.project })));
    }));

  orders
    .command('item <id> <issue>')
    .description('Change an issue\'s prerequisites, re-verify, or plan-at-pickup requirement')
    .option('--prereqs <issues>', 'Comma-separated issues that must land first; "" clears the list')
    .option('--reverify', 'Require PRD re-verification before pickup')
    .option('--no-reverify', 'Do not require PRD re-verification before pickup')
    .option('--plan-at-pickup', 'Write the plan when the issue starts')
    .option('--no-plan-at-pickup', 'Do not write the plan when the issue starts')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, issue: string, options: OrdersItemOptions) => commandAction(async () => {
      console.log(formatBook(await runOrdersItem(id, issue, options, { projectKey: options.project })));
    }));
}
