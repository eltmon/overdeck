/**
 * One status per order-book issue row (PAN-5597 WI-6): what the issue is doing,
 * or the one reason it is waiting, in plain words.
 *
 * Pure: the caller builds the book context once (`orderBookContext`) and asks
 * for each item's status. The waiting reasons come from the same dispatch
 * eligibility rules the server applies (`evaluateOrderDispatchEligibility`).
 */
import type { OrderBookItem } from '@overdeck/contracts';

import { evaluateOrderDispatchEligibility } from '../../../../../lib/orders/eligibility.js';
import { IN_FLIGHT_STATES } from '../../lib/pipeline-state';
import type { DerivedIssueState } from '../../types';
import type { OrderBookProgressItemView, OrderBookView } from './types';

export type ItemStatusTone = 'success' | 'warning' | 'info' | 'neutral';
export type ItemStatusKind = 'landed' | 'parked' | 'review' | 'working' | 'waiting' | 'ready';

export interface ItemStatus {
  kind: ItemStatusKind;
  label: string;
  tone: ItemStatusTone;
}

type ProgressItem = Required<Pick<OrderBookProgressItemView, 'issue' | 'closed' | 'parked' | 'terminal'>> & {
  lane: OrderBookItem['lane'];
  order: number;
};

/** Facts about the whole book that every row's status reads. Build once per render. */
export interface OrderBookContext {
  book: OrderBookView;
  /** Derived issue state by upper-case issue id. */
  derived: ReadonlyMap<string, DerivedIssueState>;
  /** Upper-case ids of this book's issues that occupy a pipeline slot. */
  inFlight: ReadonlySet<string>;
  prerequisiteTerminal: ReadonlyMap<string, boolean>;
  progressItems: ProgressItem[];
  flywheelRunning: boolean;
}

export function orderBookContext(
  book: OrderBookView,
  derivedById: Readonly<Record<string, DerivedIssueState>>,
  flywheelRunning: boolean,
): OrderBookContext {
  const derived = new Map(Object.values(derivedById).map((entry) => [entry.issueId.toUpperCase(), entry]));
  const inFlight = new Set(
    book.items
      .map((item) => derived.get(item.issue.toUpperCase()))
      .filter((entry): entry is DerivedIssueState => !!entry && IN_FLIGHT_STATES.has(entry.state))
      .map((entry) => entry.issueId.toUpperCase()),
  );
  const progressItems = book.items.map((item) => {
    const value = book.progress.items?.find((entry) => entry.issue.toUpperCase() === item.issue.toUpperCase());
    return {
      issue: item.issue,
      lane: item.lane,
      order: item.order,
      closed: value?.closed ?? false,
      parked: value?.parked ?? false,
      terminal: value?.terminal ?? false,
    };
  });
  return {
    book,
    derived,
    inFlight,
    prerequisiteTerminal: new Map(Object.entries(book.prerequisiteTerminal ?? {}).map(([issue, terminal]) => [issue.toUpperCase(), terminal])),
    progressItems,
    flywheelRunning,
  };
}

function progressItemFor(context: OrderBookContext, issue: string): ProgressItem | undefined {
  return context.progressItems.find((entry) => entry.issue.toUpperCase() === issue.toUpperCase());
}

/** Prerequisites that neither this book's progress nor the server's prerequisite facts call terminal. */
export function unmetPrerequisites(context: OrderBookContext, item: OrderBookItem): string[] {
  return item.prereqs
    .map((prereq) => prereq.toUpperCase())
    .filter((prereq) => {
      const own = progressItemFor(context, prereq);
      if (own?.terminal) return false;
      return context.prerequisiteTerminal.get(prereq) !== true;
    });
}

/** An item is landed when its tracker issue is closed or its derived state says so. */
export function isLanded(context: OrderBookContext, item: OrderBookItem): boolean {
  const state = context.derived.get(item.issue.toUpperCase())?.state;
  return progressItemFor(context, item.issue)?.closed === true || state === 'merged' || state === 'closed';
}

const waiting = (label: string): ItemStatus => ({ kind: 'waiting', label, tone: 'neutral' });

export function itemStatus(context: OrderBookContext, item: OrderBookItem): ItemStatus {
  const { book } = context;
  const progress = progressItemFor(context, item.issue);
  const state = context.derived.get(item.issue.toUpperCase())?.state;

  if (isLanded(context, item)) return { kind: 'landed', label: 'Landed', tone: 'success' };
  if (progress?.parked) return { kind: 'parked', label: 'Parked', tone: 'neutral' };
  if (state === 'in-review' || state === 'changes-requested' || state === 'ready') {
    return { kind: 'review', label: 'In review', tone: 'warning' };
  }
  if (state === 'working') return { kind: 'working', label: 'Working', tone: 'info' };
  if (book.phase === 'draft') return waiting('Not queued yet');
  if (book.phase === 'queued') return waiting('Book is not active yet');
  if (book.phase === 'archived') return waiting('Not started');

  const eligibility = evaluateOrderDispatchEligibility({
    book,
    progress: {
      bookId: book.id,
      total: book.progress.total,
      landed: book.progress.landed,
      drained: book.progress.drained,
      items: context.progressItems,
    },
    issueId: item.issue,
    inFlightIssues: context.inFlight,
    prerequisiteTerminal: context.prerequisiteTerminal,
  });
  const unmet = (key: string) => eligibility.conditions.some((condition) => condition.key === key && !condition.met);

  if (unmet('pickup-posture')) return waiting('Pickup paused');
  if (unmet('prerequisites')) {
    const ids = unmetPrerequisites(context, item);
    return waiting(`Waiting for ${(ids.length > 0 ? ids : item.prereqs.map((prereq) => prereq.toUpperCase())).join(', ')}`);
  }
  if (unmet('prd-reverified')) return waiting('PRD needs a re-check first');
  if (unmet('lane-slot')) {
    if (item.lane === 'B') return waiting('Waiting its turn');
    const running = book.items.filter((candidate) =>
      candidate.lane === 'A'
      && candidate.issue.toUpperCase() !== item.issue.toUpperCase()
      && context.inFlight.has(candidate.issue.toUpperCase())).length;
    return waiting(`Waiting for a free slot (${running} of ${book.settings.laneAConcurrency} running)`);
  }
  if (context.flywheelRunning) return { kind: 'ready', label: 'Starts next', tone: 'neutral' };
  return { kind: 'ready', label: 'Ready, Flywheel is stopped', tone: 'neutral' };
}
