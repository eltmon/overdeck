/**
 * PAN-5598 WI-7/WI-8/WI-9: the `pan orders` verbs beyond create/list/show/
 * add/remove/move/queue/start, in a separate file so this branch and
 * PAN-5597 do not edit the same lines of orders.ts.
 */
import type { OrderBook } from '@overdeck/contracts';
import { Command, InvalidArgumentError } from 'commander';

import type { SequenceNode } from '../../lib/backlog/types.js';
import { previewBrief } from '../../lib/orders/brief.js';
import { backlogCandidates } from '../../lib/orders/resolver.js';
import { renameBook, setItemRequirements, setSettings } from '../../lib/orders/writer.js';
import { findProjectByPath, listProjectsSync } from '../../lib/projects.js';
import { callDashboard, errorText, isDashboardUnreachable } from './dashboard-call.js';
import { commandAction, commitOrders, formatBook, type OrdersCommandDeps, panDirFor, requireBook } from './orders.js';

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

/** `check`'s dashboard caller is injected so tests need no running server. */
export interface OrdersCheckDeps extends OrdersCommandDeps {
  callDashboard?: typeof callDashboard;
}

function parseParallel(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) throw new InvalidArgumentError('must be an integer from 1 to 8');
  return parsed;
}

function parseCandidatesLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new InvalidArgumentError('must be an integer from 1 to 100');
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

export async function runOrdersPreview(bookId: string, deps: OrdersCommandDeps = {}): Promise<string> {
  return previewBrief(await requireBook(panDirFor(deps), bookId));
}

export function runOrdersCandidates(limit: number, deps: OrdersCommandDeps = {}): SequenceNode[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be an integer from 1 to 100');
  return backlogCandidates(panDirFor(deps), limit);
}

/** D8: resolves the project key on the CLI side (the same rule as every other verb) and always sends it. */
function resolveCheckProjectKey(deps: OrdersCheckDeps): string {
  if (deps.projectKey !== undefined) return deps.projectKey;
  const cwd = deps.cwd ?? process.cwd();
  const project = findProjectByPath(cwd);
  const key = project ? listProjectsSync().find((entry) => entry.config.path === project.path)?.key : undefined;
  if (!key) throw new Error(`No configured project contains ${cwd}`);
  return key;
}

export async function runOrdersCheck(
  bookId: string,
  deps: OrdersCheckDeps = {},
): Promise<{ blocks: ReadonlyArray<{ issue: string; message: string }>; warns: ReadonlyArray<{ issue: string; message: string }> }> {
  const projectKey = resolveCheckProjectKey(deps);
  const call = deps.callDashboard ?? callDashboard;
  let response: Response;
  try {
    response = await call(`/api/orders/${encodeURIComponent(bookId)}?project=${encodeURIComponent(projectKey)}`, { method: 'GET' });
  } catch (error) {
    if (isDashboardUnreachable(error)) throw new Error('The dashboard is not reachable. Start it with pan up, then retry.');
    throw error;
  }
  if (!response.ok) throw new Error(await errorText(response));
  const body = await response.json() as {
    validation?: { blocks?: Array<{ issue: string; message: string }>; warns?: Array<{ issue: string; message: string }> };
  };
  return { blocks: body.validation?.blocks ?? [], warns: body.validation?.warns ?? [] };
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

  orders
    .command('preview <id>')
    .description('Print the brief the Flywheel receives for an order book')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      console.log(await runOrdersPreview(id, { projectKey: options.project }));
    }));

  orders
    .command('candidates')
    .description('List the top backlog issues that are in no order book')
    .option('--limit <n>', 'Max candidates to print (1-100); default 10', parseCandidatesLimit)
    .option('--project <key>', 'Resolve the backlog sequence in another registered project')
    .action((options: { limit?: number; project?: string }) => commandAction(async () => {
      const candidates = runOrdersCandidates(options.limit ?? 10, { projectKey: options.project });
      if (candidates.length === 0) {
        console.log('No backlog candidates.');
        return;
      }
      for (const candidate of candidates) console.log(`${candidate.rank}  ${candidate.issue}  ${candidate.why}`);
    }));

  orders
    .command('check <id>')
    .description('Print the problems that block an order book from starting')
    .option('--project <key>', 'Resolve the order book in another registered project')
    .action((id: string, options: { project?: string }) => commandAction(async () => {
      const { blocks, warns } = await runOrdersCheck(id, { projectKey: options.project });
      if (blocks.length === 0 && warns.length === 0) {
        console.log('No problems.');
      } else {
        for (const block of blocks) console.log(`BLOCK ${block.issue} ${block.message}`);
        for (const warn of warns) console.log(`WARN ${warn.issue} ${warn.message}`);
      }
      if (blocks.length > 0) process.exitCode = 1;
    }));
}
