import { existsSync, readFileSync } from 'node:fs';
import type { OrderBook } from '@overdeck/contracts';
import type { SequenceNode } from '../backlog/types.js';
import { parseSequenceMd } from '../backlog/sequence-io.js';
import { LEGACY_PARKED_LABELS, PARKED_LABEL } from '../backlog/pickup.js';
import { backlogSequencePath, listOrderBookIds, readOrderBook, readOrderBookAsync } from './io.js';
import type { OrderBookProgress, OrderIssueLookup, OrderIssueState } from './types.js';

const COMPLETE_STATUS = 'complete';

function labelNames(issue: Record<string, unknown>): string[] {
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  return labels
    .map((label) =>
      typeof label === 'string'
        ? label
        : typeof label === 'object' && label !== null && typeof (label as { name?: unknown }).name === 'string'
          ? (label as { name: string }).name
          : '',
    )
    .filter(Boolean)
    .map((label) => label.toLowerCase());
}

function issueIdentifier(issue: Record<string, unknown>): string {
  for (const key of ['identifier', 'issueId', 'id']) {
    const value = issue[key];
    if (typeof value === 'string' && value) return value.toUpperCase();
  }
  return '';
}

function issueIsClosed(issue: Record<string, unknown>): boolean {
  const values = [issue.canonicalStatus, issue.status, issue.state]
    .map((value) => (typeof value === 'string' ? value.toLowerCase().replace(/[ -]/g, '_') : ''));
  return values.some((value) =>
    ['done', 'completed', 'closed', 'canceled', 'cancelled'].includes(value),
  );
}

export const liveOrderIssueLookup: OrderIssueLookup = (issueIds) => {
  const wanted = new Set(issueIds.map((id) => id.toUpperCase()));
  const result = new Map<string, OrderIssueState>();
  try {
    // Lazy require avoids a static lib → dashboard server dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as typeof import('../../dashboard/server/services/issue-service-singleton.js');
    const issues = getSharedIssueService().getIssues({ cycle: 'all', includeCompleted: true }) as Array<Record<string, unknown>>;
    for (const issue of issues) {
      const id = issueIdentifier(issue);
      if (!wanted.has(id)) continue;
      const labels = labelNames(issue);
      const closed = issueIsClosed(issue);
      result.set(id, {
        issue: id,
        open: !closed,
        parked: labels.includes(PARKED_LABEL) || LEGACY_PARKED_LABELS.some((label) => labels.includes(label)),
      });
    }
  } catch {
    // A non-server caller receives missing issue state and validation blocks safely.
  }
  return result;
};

/** The sole order-book read door. */
export function listBooks(stateRoot: string): OrderBook[] {
  return listOrderBookIds(stateRoot).map((id) => {
    const book = readOrderBook(stateRoot, id);
    if (!book) throw new Error(`Order book index references missing book ${id}`);
    return book;
  });
}

export function getBook(stateRoot: string, bookId: string): OrderBook | null {
  return readOrderBook(stateRoot, bookId);
}

export function getBookAsync(stateRoot: string, bookId: string): Promise<OrderBook | null> {
  return readOrderBookAsync(stateRoot, bookId);
}

export function membership(stateRoot: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const book of listBooks(stateRoot)) {
    if (book.status === COMPLETE_STATUS) continue;
    for (const item of book.items) {
      const issue = item.issue.toUpperCase();
      const existing = result.get(issue);
      if (existing && existing !== book.id) {
        throw new Error(`Issue ${issue} belongs to multiple non-complete order books: ${existing}, ${book.id}`);
      }
      result.set(issue, book.id);
    }
  }
  return result;
}

export function backlogCandidates(stateRoot: string, limit: number): SequenceNode[] {
  if (limit <= 0) return [];
  const path = backlogSequencePath(stateRoot);
  if (!existsSync(path)) return [];
  const parsed = parseSequenceMd(readFileSync(path, 'utf8'));
  if (!parsed.ok) throw new Error(`Could not parse backlog sequence: ${parsed.error}`);

  const assigned = membership(stateRoot);
  return [...parsed.doc.nodes]
    .sort((a, b) => a.rank - b.rank)
    .filter((node) => !assigned.has(node.issue.toUpperCase()))
    .slice(0, limit);
}

export function computeBookProgress(
  book: OrderBook,
  issueLookup: OrderIssueLookup = liveOrderIssueLookup,
): OrderBookProgress {
  const state = issueLookup(book.items.map((item) => item.issue));
  const items = book.items.map((item) => {
    const issue = state.get(item.issue.toUpperCase());
    const closed = issue ? !issue.open : false;
    const parked = issue?.parked ?? false;
    return {
      issue: item.issue,
      lane: item.lane,
      order: item.order,
      closed,
      parked,
      terminal: closed || parked,
    };
  });
  return {
    bookId: book.id,
    total: items.length,
    landed: items.filter((item) => item.closed).length,
    items,
    drained: items.every((item) => item.terminal),
  };
}
