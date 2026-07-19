import { readFile } from 'node:fs/promises';
import type { OrderBook } from '@overdeck/contracts';

import { requireFlywheelBrief } from '../../lib/flywheel-start.js';
import { getBook } from '../../lib/orders/resolver.js';
import { validateBookForStart } from '../../lib/orders/validate.js';
import { setStatus as setOrderBookStatus } from '../../lib/orders/writer.js';
import { findProjectByPathSync } from '../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../lib/state-read-home.js';

export interface FlywheelOrderStartDeps {
  orderStateRoot?: (cwd: string) => string;
  getOrderBook?: typeof getBook;
  validateOrderBook?: typeof validateBookForStart;
  setOrderStatus?: typeof setOrderBookStatus;
  requireBrief?: typeof requireFlywheelBrief;
  readBrief?: (path: string) => Promise<string>;
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

export function resolveFlywheelOrderStart(
  cwd: string,
  bookId: string,
  deps: FlywheelOrderStartDeps = {},
): FlywheelOrderStartContext {
  const stateRoot = (deps.orderStateRoot ?? orderStateRootFor)(cwd);
  const book = (deps.getOrderBook ?? getBook)(stateRoot, bookId);
  if (!book) throw new Error(`Order book not found: ${bookId}`);
  if (book.status !== 'ready') {
    throw new Error(`Order book ${book.id} must be ready before start (current status: ${book.status})`);
  }
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

export async function setFlywheelOrderStatus(
  context: FlywheelOrderStartContext,
  status: 'ready' | 'running',
  runId: string | undefined,
  deps: FlywheelOrderStartDeps = {},
): Promise<void> {
  await (deps.setOrderStatus ?? setOrderBookStatus)(
    context.stateRoot,
    context.book.id,
    status,
    runId ? { runId } : {},
  );
}
