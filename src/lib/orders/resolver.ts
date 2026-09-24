import { existsSync, readFileSync } from 'node:fs';
import type { OrderBook } from '@overdeck/contracts';
import type { SequenceNode } from '../backlog/types.js';
import { parseSequenceMd } from '../backlog/sequence-io.js';
import { LEGACY_PARKED_LABELS, PARKED_LABEL } from '../backlog/pickup.js';
import { findProjectByPathSync } from '../projects.js';
import { backlogSequencePath, listOrderBookIds, readOrderBook, readOrderBookAsync, readOrderBookIndex } from './io.js';
import type { OrderBookProgress, OrderIssueLookup, OrderIssueState } from './types.js';

const COMPLETE_STATUS = 'complete';

/**
 * The issue prefix (e.g. "PAN") of the project that owns an orders directory,
 * or null when it cannot be determined. `panDir` is `<planHome>/.pan`, which
 * lives inside a registered checkout, so path containment is the match.
 */
export function issuePrefixForStateRoot(panDir: string): string | null {
  try {
    const byPath = findProjectByPathSync(panDir);
    return byPath?.issue_prefix ? byPath.issue_prefix.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Canonical form for an order-book issue reference: bare digits gain the
 * project prefix ("2351" → "PAN-2351"); anything else passes through
 * unchanged. Books written before the write door normalized on entry carry
 * bare numbers; every read-side consumer (validation, progress, membership,
 * dispatch) resolves them through this.
 */
export function normalizeOrderIssueId(panDir: string, issueId: string): string {
  if (!/^\d+$/.test(issueId)) return issueId;
  const prefix = issuePrefixForStateRoot(panDir);
  return prefix ? `${prefix}-${issueId}` : issueId;
}

function normalizeBookIssues(panDir: string, book: OrderBook): OrderBook {
  const hasBare = book.items.some(
    (item) => /^\d+$/.test(item.issue) || item.prereqs.some((prereq) => /^\d+$/.test(prereq)),
  );
  if (!hasBare) return book;
  const prefix = issuePrefixForStateRoot(panDir);
  if (!prefix) return book;
  const expand = (id: string): string => (/^\d+$/.test(id) ? `${prefix}-${id}` : id);
  return {
    ...book,
    items: book.items.map((item) => ({
      ...item,
      issue: expand(item.issue),
      prereqs: item.prereqs.map(expand),
    })),
  };
}

type IssueServiceModule = typeof import('../../dashboard/server/services/issue-service-singleton.js');
let issueServiceModule: IssueServiceModule | null = null;

function loadIssueServiceModuleSync(): IssueServiceModule {
  if (issueServiceModule) return issueServiceModule;
  // Lazy require avoids a static lib → dashboard server dependency.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  issueServiceModule = require('../../dashboard/server/services/issue-service-singleton.js') as IssueServiceModule;
  return issueServiceModule;
}

async function loadIssueServiceModule(): Promise<IssueServiceModule> {
  if (issueServiceModule) return issueServiceModule;
  issueServiceModule = await import('../../dashboard/server/services/issue-service-singleton.js');
  return issueServiceModule;
}

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
    const { getSharedIssueService } = loadIssueServiceModuleSync();
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

/**
 * Load the issue-service module through `import()` and start the shared service without polling.
 *
 * Test seam: no production caller (the dashboard starts the shared service itself). Tests call it so
 * the resolver's module cache holds the mocked issue-service module, which the `require()` path in
 * `loadIssueServiceModuleSync` cannot reach (PAN-3958 CH-8).
 */
export async function ensureOrderIssueStore(): Promise<void> {
  const { startSharedIssueService } = await loadIssueServiceModule();
  await startSharedIssueService({ skipPolling: true });
}

export function orderIssueStoreStatus(): { started: boolean; issueCount: number } {
  try {
    const { getSharedIssueService, isSharedIssueServiceStarted } = loadIssueServiceModuleSync();
    const started = isSharedIssueServiceStarted();
    const issueCount = getSharedIssueService().getIssues({ cycle: 'all', includeCompleted: true }).length as number;
    return { started, issueCount };
  } catch {
    return { started: false, issueCount: 0 };
  }
}

/** The sole order-book read door. */
export function listBooks(panDir: string): OrderBook[] {
  return listOrderBookIds(panDir).map((id) => {
    const book = readOrderBook(panDir, id);
    if (!book) throw new Error(`Order book index references missing book ${id}`);
    return normalizeBookIssues(panDir, book);
  });
}

export function getBook(panDir: string, bookId: string): OrderBook | null {
  const book = readOrderBook(panDir, bookId);
  return book ? normalizeBookIssues(panDir, book) : null;
}

export function getBookAsync(panDir: string, bookId: string): Promise<OrderBook | null> {
  return readOrderBookAsync(panDir, bookId).then((book) => (book ? normalizeBookIssues(panDir, book) : null));
}

/** The first 'ready' book in index.json queue order, or null if none is ready. */
export function firstReadyBookInQueue(panDir: string): OrderBook | null {
  for (const entry of readOrderBookIndex(panDir)) {
    const book = getBook(panDir, entry.id);
    if (book?.status === 'ready') return book;
  }
  return null;
}

export function membership(panDir: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const book of listBooks(panDir)) {
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

export function backlogCandidates(panDir: string, limit: number): SequenceNode[] {
  if (limit <= 0) return [];
  const path = backlogSequencePath(panDir);
  if (!existsSync(path)) return [];
  const parsed = parseSequenceMd(readFileSync(path, 'utf8'));
  if (!parsed.ok) throw new Error(`Could not parse backlog sequence: ${parsed.error}`);

  const assigned = membership(panDir);
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
