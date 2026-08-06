import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { OrderBook } from '@overdeck/contracts';
import { listBooks, orderIssueStoreStatus } from './resolver.js';
import { liveOrderIssueLookup } from './resolver.js';
import type {
  OrderBookFinding,
  OrderBookValidationResult,
  OrderIssueLookup,
} from './types.js';

function hasNonEmptyFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function issuePattern(issueId: string): RegExp {
  const escaped = issueId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[-_])${escaped}(?:[-_.]|$)`, 'i');
}

function nonEmptyFileNames(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => hasNonEmptyFile(join(directory, name)));
}

export function createOrderPrdLookup(stateRoot: string): (issueId: string) => boolean {
  const draftNames = new Set([
    ...nonEmptyFileNames(join(stateRoot, 'drafts')),
    ...nonEmptyFileNames(join(stateRoot, '.pan', 'drafts')),
  ].map((name) => name.toLowerCase()));
  const specNames = [
    ...nonEmptyFileNames(join(stateRoot, 'specs')),
    ...nonEmptyFileNames(join(stateRoot, '.pan', 'specs')),
  ];
  return (issueId: string) => {
    const lower = issueId.toLowerCase();
    if (draftNames.has(`${lower}.md`)) return true;
    const pattern = issuePattern(issueId);
    return specNames.some((name) => pattern.test(name));
  };
}

export function hasOrderIssuePrd(stateRoot: string, issueId: string): boolean {
  const lower = issueId.toLowerCase();
  const draftPaths = [
    join(stateRoot, 'drafts', `${lower}.md`),
    join(stateRoot, '.pan', 'drafts', `${lower}.md`),
  ];
  if (draftPaths.some(hasNonEmptyFile)) return true;

  for (const specsDir of [join(stateRoot, 'specs'), join(stateRoot, '.pan', 'specs')]) {
    if (!existsSync(specsDir)) continue;
    const pattern = issuePattern(issueId);
    if (readdirSync(specsDir).some((name) => pattern.test(name) && hasNonEmptyFile(join(specsDir, name)))) {
      return true;
    }
  }
  return false;
}

function findCycle(book: OrderBook): string[] | null {
  const issues = new Set(book.items.map((item) => item.issue.toUpperCase()));
  const edges = new Map(
    book.items.map((item) => [
      item.issue.toUpperCase(),
      item.prereqs.map((prereq) => prereq.toUpperCase()).filter((prereq) => issues.has(prereq)),
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (issue: string): string[] | null => {
    if (visiting.has(issue)) {
      const start = path.indexOf(issue);
      return [...path.slice(start), issue];
    }
    if (visited.has(issue)) return null;
    visiting.add(issue);
    path.push(issue);
    for (const prereq of edges.get(issue) ?? []) {
      const cycle = visit(prereq);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(issue);
    visited.add(issue);
    return null;
  };

  for (const issue of issues) {
    const cycle = visit(issue);
    if (cycle) return cycle;
  }
  return null;
}

export function validateBookForStart(
  stateRoot: string,
  book: OrderBook,
  options: {
    issueLookup?: OrderIssueLookup;
    storeStatus?: () => { started: boolean; issueCount: number };
    hasPrd?: (issueId: string) => boolean;
    books?: readonly OrderBook[];
  } = {},
): OrderBookValidationResult {
  const blocks: OrderBookFinding[] = [];
  const warns: OrderBookFinding[] = [];

  const storeStatus = options.issueLookup
    ? null
    : (options.storeStatus ?? orderIssueStoreStatus)();
  const storeUnavailable = storeStatus !== null
    && (!storeStatus.started || storeStatus.issueCount === 0);
  if (storeUnavailable) {
    blocks.push({
      code: 'issue-store-unavailable',
      issue: book.id,
      message: 'Issue store is unavailable or empty — start the dashboard once (`pan up`) to populate the shared issue cache, then retry',
    });
  }

  if (book.items.length === 0) {
    blocks.push({
      code: 'empty-book',
      issue: book.id,
      message: 'Order book must contain at least one issue',
    });
  }
  const issueLookup = options.issueLookup ?? liveOrderIssueLookup;
  const ids = new Set<string>();
  for (const item of book.items) {
    ids.add(item.issue.toUpperCase());
    item.prereqs.forEach((prereq) => ids.add(prereq.toUpperCase()));
  }
  const issueState = storeUnavailable ? new Map() : issueLookup([...ids]);

  if (!storeUnavailable) {
    for (const item of book.items) {
      const issue = item.issue.toUpperCase();
      const state = issueState.get(issue);
      if (!state?.open) {
        blocks.push({
          code: 'issue-not-open',
          issue,
          message: state ? `${issue} is not open` : `${issue} could not be resolved as an open issue`,
        });
      }
    }
  }

  for (const other of options.books ?? listBooks(stateRoot)) {
    if (other.id === book.id || other.status === 'complete') continue;
    for (const item of other.items) {
      const issue = item.issue.toUpperCase();
      if (!ids.has(issue) || !book.items.some((candidate) => candidate.issue.toUpperCase() === issue)) continue;
      blocks.push({
        code: 'duplicate-membership',
        issue,
        message: `${issue} already belongs to non-complete order book ${other.id}`,
      });
    }
  }

  const bookIssues = new Set(book.items.map((item) => item.issue.toUpperCase()));
  if (!storeUnavailable) {
    for (const item of book.items) {
      for (const rawPrereq of item.prereqs) {
        const prereq = rawPrereq.toUpperCase();
        if (!bookIssues.has(prereq) && !issueState.has(prereq)) {
          blocks.push({
            code: 'unresolved-prerequisite',
            issue: item.issue,
            message: `${item.issue} prerequisite ${prereq} could not be resolved`,
          });
        }
      }
    }
  }

  const cycle = findCycle(book);
  if (cycle) {
    blocks.push({
      code: 'prerequisite-cycle',
      issue: cycle[0]!,
      message: `Prerequisite cycle: ${cycle.join(' → ')}`,
    });
  }

  const hasPrd = options.hasPrd ?? ((issueId: string) => hasOrderIssuePrd(stateRoot, issueId));
  for (const item of book.items) {
    if (item.lane !== 'B' || hasPrd(item.issue)) continue;
    const finding: OrderBookFinding = {
      code: 'missing-prd',
      issue: item.issue,
      message: `${item.issue} has no draft PRD or canonical spec`,
    };
    if (item.planAtPickup) warns.push(finding);
    else blocks.push(finding);
  }

  return { blocks, warns };
}
