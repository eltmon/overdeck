import { readFile } from 'node:fs/promises';
import type { OrderBook } from '@overdeck/contracts';

import { abortSpawnedFlywheel } from '../../lib/cloister/flywheel.js';
import { requireFlywheelBrief } from '../../lib/flywheel-start.js';
import { ensureOrderIssueStore, getBook } from '../../lib/orders/resolver.js';
import { validateBookForStart } from '../../lib/orders/validate.js';
import { setStatus as setOrderBookStatus } from '../../lib/orders/writer.js';
import { findProjectByPathSync } from '../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../lib/state-read-home.js';

export interface FlywheelOrderStartDeps {
  orderStateRoot?: (cwd: string) => string;
  getOrderBook?: typeof getBook;
  prepareIssueStore?: () => Promise<unknown>;
  validateOrderBook?: typeof validateBookForStart;
  setOrderStatus?: typeof setOrderBookStatus;
  requireBrief?: typeof requireFlywheelBrief;
  readBrief?: (path: string) => Promise<string>;
  cleanupSpawnedRun?: (runId: string) => Promise<void>;
}

export interface FlywheelOrderStartContext {
  stateRoot: string;
  book: OrderBook;
}

function orderStateRootFor(cwd: string): string {
  const project = findProjectByPathSync(cwd);
  if (!project) throw new Error(`No configured project contains ${cwd}`);
  return resolveStateReadHomeSync(project).root;
}

function validationError(bookId: string, findings: readonly { code: string; issue: string; message: string }[]): Error {
  return new Error([
    `Order book ${bookId} cannot start:`,
    ...findings.map((finding) => `- [${finding.code}] ${finding.issue}: ${finding.message}`),
  ].join('\n'));
}

export async function resolveFlywheelOrderStart(
  cwd: string,
  bookId: string,
  deps: FlywheelOrderStartDeps = {},
): Promise<FlywheelOrderStartContext> {
  const stateRoot = (deps.orderStateRoot ?? orderStateRootFor)(cwd);
  const book = (deps.getOrderBook ?? getBook)(stateRoot, bookId);
  if (!book) throw new Error(`Order book not found: ${bookId}`);
  if (book.status !== 'ready') {
    throw new Error(`Order book ${book.id} must be ready before start (current status: ${book.status})`);
  }
  await (deps.prepareIssueStore ?? ensureOrderIssueStore)();
  const validation = (deps.validateOrderBook ?? validateBookForStart)(stateRoot, book);
  if (validation.blocks.length > 0) throw validationError(book.id, validation.blocks);
  return { stateRoot, book };
}

export async function resolveFlywheelOrderBriefOverlay(
  cwd: string,
  book: OrderBook | null,
  deps: FlywheelOrderStartDeps = {},
): Promise<{ briefOverlayPath?: string; briefOverlayContent?: string }> {
  const path = book?.settings.briefOverlay?.trim();
  if (!path) return {};
  const brief = await (deps.requireBrief ?? requireFlywheelBrief)(cwd, path);
  return {
    briefOverlayPath: brief.displayPath,
    briefOverlayContent: await (deps.readBrief ?? ((absolutePath) => readFile(absolutePath, 'utf8')))(brief.absolutePath),
  };
}

export async function compensateFailedFlywheelStart(
  context: FlywheelOrderStartContext | null,
  runId: string,
  cause: unknown,
  deps: FlywheelOrderStartDeps = {},
): Promise<never> {
  const failures = [cause];
  try {
    await (deps.cleanupSpawnedRun ?? abortSpawnedFlywheel)(runId);
  } catch (error) {
    failures.push(error);
  }
  if (context) {
    try {
      await setFlywheelOrderStatus(context, 'ready', null, deps);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, `Flywheel run ${runId} failed to start and compensation was incomplete`);
  }
  throw cause;
}

export async function setFlywheelOrderStatus(
  context: FlywheelOrderStartContext,
  status: 'ready' | 'running',
  runId: string | null | undefined,
  deps: FlywheelOrderStartDeps = {},
): Promise<void> {
  await (deps.setOrderStatus ?? setOrderBookStatus)(
    context.stateRoot,
    context.book.id,
    status,
    runId === undefined ? {} : { runId },
  );
}
