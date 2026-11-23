/**
 * PAN-5598: project resolution, the write-door commit/push helper, and the
 * command-error wrapper shared by orders.ts and orders-edit.ts. Kept apart
 * from both so neither file imports the other (a circular import the
 * lint:circular guard refuses).
 */
import type { OrderBook } from '@overdeck/contracts';
import chalk from 'chalk';
import { dirname, join } from 'node:path';

import { getBookAsync } from '../../lib/orders/resolver.js';
import type { OrderIssueLookup } from '../../lib/orders/types.js';
import { commitPlanArtifacts, pushPlanArtifacts } from '../../lib/overdeck/plan-artifact-commit.js';
import { surfacePlanArtifactPush } from '../../lib/overdeck/plan-artifact-push-report.js';
import { getProjectPanPaths } from '../../lib/pan-dir/paths.js';
import { findProjectByPath, getProjectSync, resolveProjectPath, type ProjectConfig } from '../../lib/projects.js';
import type { FlywheelRunResult } from './flywheel.js';

export interface OrdersCommandDeps {
  cwd?: string;
  panDir?: string;
  projectKey?: string;
  now?: () => Date;
  actor?: string;
  startOrderBook?: (bookId: string) => Promise<FlywheelRunResult>;
  issueLookup?: OrderIssueLookup;
}

export interface OrdersProjectResolution {
  /** `<planHome>/.pan` — order books are project-level artifacts on `main`. */
  panDir: string;
  projectConfig?: ProjectConfig;
}

export function resolveOrdersProject(deps: OrdersCommandDeps = {}): OrdersProjectResolution {
  if (deps.panDir) return { panDir: deps.panDir };
  if (deps.projectKey !== undefined) {
    const project = getProjectSync(deps.projectKey);
    if (!project) throw new Error(`Unknown project: ${deps.projectKey}`);
    return { panDir: getProjectPanPaths(resolveProjectPath(project)).panDir, projectConfig: project };
  }
  const cwd = deps.cwd ?? process.cwd();
  const project = findProjectByPath(cwd);
  if (!project) throw new Error(`No configured project contains ${cwd}`);
  return { panDir: getProjectPanPaths(resolveProjectPath(project)).panDir, projectConfig: project };
}

export function panDirFor(deps: OrdersCommandDeps = {}): string {
  return resolveOrdersProject(deps).panDir;
}

/**
 * Order books live in `<planHome>/.pan/orders/` on `main`, and the verb that
 * writes one commits it (PAN-3917: no daemon commits .pan/ behind your back)
 * and pushes it, so the plan home does not drift ahead of origin (#4108).
 */
export async function commitOrders(panDir: string, subject: string): Promise<void> {
  const planHome = dirname(panDir);
  const commit = await commitPlanArtifacts({ cwd: planHome, paths: [join(panDir, 'orders')], message: subject });
  if (!commit.committed && commit.reason !== 'nothing to commit') {
    console.error(chalk.yellow(`⚠ Could not commit the order book: ${commit.reason}`));
    return;
  }
  const push = await pushPlanArtifacts(planHome);
  const description = await surfacePlanArtifactPush(push, { planHome, command: 'pan orders' });
  if (description) console.error(chalk.yellow(`⚠ Order book push: ${description.message}`));
}

export async function requireBook(panDir: string, bookId: string): Promise<OrderBook> {
  const book = await getBookAsync(panDir, bookId);
  if (!book) throw new Error(`Order book not found: ${bookId}`);
  return book;
}

export function formatBook(book: OrderBook): string {
  return JSON.stringify(book, null, 2);
}

export async function commandAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
