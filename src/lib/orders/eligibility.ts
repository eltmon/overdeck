import type { OrderBook } from '@overdeck/contracts';

import type { OrderBookProgress } from './types.js';

export type OrderEligibilityConditionKey =
  | 'book-membership'
  | 'lane-slot'
  | 'prerequisites';

export interface OrderEligibilityCondition {
  key: OrderEligibilityConditionKey;
  met: boolean;
  detail: string;
}

export interface OrderDispatchEligibility {
  eligible: boolean;
  overrideUsed: boolean;
  code?: 'off-book' | 'lane-b-busy' | 'lane-a-full' | 'prerequisite-unmet';
  message?: string;
  conditions: OrderEligibilityCondition[];
}

export interface EvaluateOrderDispatchInput {
  book: OrderBook;
  progress: OrderBookProgress;
  issueId: string;
  inFlightIssues: ReadonlySet<string>;
  offBook?: boolean;
}

export function evaluateOrderDispatchEligibility(input: EvaluateOrderDispatchInput): OrderDispatchEligibility {
  const issueId = input.issueId.toUpperCase();
  const item = input.book.items.find((candidate) => candidate.issue.toUpperCase() === issueId);
  if (!item) {
    const overrideUsed = input.offBook === true;
    return {
      eligible: overrideUsed,
      overrideUsed,
      ...(overrideUsed ? {} : {
        code: 'off-book' as const,
        message: `Issue ${issueId} is not in active order book ${input.book.id}; work-agent dispatch is blocked. Retry with --off-book only for an intentional exception.`,
      }),
      conditions: [{
        key: 'book-membership',
        met: overrideUsed,
        detail: overrideUsed
          ? `Issue ${issueId} is outside the book and the operator supplied --off-book.`
          : `Issue ${issueId} is not a member of ${input.book.id}.`,
      }],
    };
  }

  const terminalByIssue = new Map(input.progress.items.map((progress) => [progress.issue.toUpperCase(), progress.terminal]));
  const unmetPrereq = item.prereqs.find((prereq) => terminalByIssue.get(prereq.toUpperCase()) !== true);
  const prereqsMet = unmetPrereq === undefined;
  const otherInFlight = input.book.items.filter((candidate) =>
    candidate.issue.toUpperCase() !== issueId
    && input.inFlightIssues.has(candidate.issue.toUpperCase()),
  );
  const laneBBlocker = item.lane === 'B'
    ? otherInFlight.find((candidate) => candidate.lane === 'B')
    : undefined;
  const laneAInFlight = otherInFlight.filter((candidate) => candidate.lane === 'A').length;
  const laneSlotFree = item.lane === 'B'
    ? laneBBlocker === undefined
    : laneAInFlight < input.book.settings.laneAConcurrency;

  const conditions: OrderEligibilityCondition[] = [
    { key: 'book-membership', met: true, detail: `${issueId} is a member of ${input.book.id}.` },
    {
      key: 'lane-slot',
      met: laneSlotFree,
      detail: item.lane === 'B'
        ? (laneBBlocker ? `Lane B is occupied by ${laneBBlocker.issue}.` : 'Lane B has no issue in flight.')
        : `${laneAInFlight}/${input.book.settings.laneAConcurrency} Lane A slots are in flight.`,
    },
    {
      key: 'prerequisites',
      met: prereqsMet,
      detail: unmetPrereq ? `Prerequisite ${unmetPrereq.toUpperCase()} is not terminal.` : 'Every prerequisite is landed or parked.',
    },
  ];

  if (unmetPrereq) {
    return {
      eligible: false,
      overrideUsed: false,
      code: 'prerequisite-unmet',
      message: `Issue ${issueId} cannot start because prerequisite ${unmetPrereq.toUpperCase()} has not landed or been parked.`,
      conditions,
    };
  }
  if (laneBBlocker) {
    return {
      eligible: false,
      overrideUsed: false,
      code: 'lane-b-busy',
      message: `Issue ${issueId} cannot start in Lane B because ${laneBBlocker.issue} is still in flight; Lane B allows one active issue at a time.`,
      conditions,
    };
  }
  if (item.lane === 'A' && !laneSlotFree) {
    return {
      eligible: false,
      overrideUsed: false,
      code: 'lane-a-full',
      message: `Issue ${issueId} cannot start in Lane A because ${laneAInFlight} issues are already in flight and laneAConcurrency is ${input.book.settings.laneAConcurrency}.`,
      conditions,
    };
  }
  return { eligible: true, overrideUsed: false, conditions };
}
