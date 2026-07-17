import { OrderBook as OrderBookSchema } from '@overdeck/contracts';
import { Schema } from 'effect';

export {
  OrderBook,
  OrderBookIndexEntry,
  OrderBookItem,
  OrderBookLane,
  OrderBookPosture,
  OrderBookSettings,
  OrderBookStatus,
} from '@overdeck/contracts';
export type {
  OrderBook as OrderBookType,
  OrderBookIndexEntry as OrderBookIndexEntryType,
  OrderBookItem as OrderBookItemType,
  OrderBookLane as OrderBookLaneType,
  OrderBookPosture as OrderBookPostureType,
  OrderBookSettings as OrderBookSettingsType,
  OrderBookStatus as OrderBookStatusType,
} from '@overdeck/contracts';

export type OrderBookParseError = { ok: false; error: string };
export type OrderBookParseResult =
  | { ok: true; book: typeof OrderBookSchema.Type }
  | OrderBookParseError;

const decodeOrderBook = Schema.decodeUnknownSync(OrderBookSchema);

export function parseOrderBookJson(value: unknown): OrderBookParseResult {
  try {
    return { ok: true, book: decodeOrderBook(value) };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid order book: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface OrderIssueState {
  issue: string;
  open: boolean;
  parked: boolean;
}

export type OrderIssueLookup = (
  issueIds: readonly string[],
) => ReadonlyMap<string, OrderIssueState>;

export interface OrderBookItemProgress {
  issue: string;
  lane: typeof import('@overdeck/contracts').OrderBookLane.Type;
  order: number;
  closed: boolean;
  parked: boolean;
  terminal: boolean;
}

export interface OrderBookProgress {
  bookId: string;
  total: number;
  landed: number;
  items: readonly OrderBookItemProgress[];
  drained: boolean;
}

export type OrderBookFindingCode =
  | 'issue-not-open'
  | 'duplicate-membership'
  | 'unresolved-prerequisite'
  | 'prerequisite-cycle'
  | 'missing-prd';

export interface OrderBookFinding {
  code: OrderBookFindingCode;
  issue: string;
  message: string;
}

export interface OrderBookValidationResult {
  blocks: OrderBookFinding[];
  warns: OrderBookFinding[];
}
