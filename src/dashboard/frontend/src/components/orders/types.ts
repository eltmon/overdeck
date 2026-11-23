/**
 * Order book view types: the enriched book the orders API returns.
 */
import type { OrderBook } from '@overdeck/contracts';

export interface OrderBookProgressItemView {
  issue: string;
  closed: boolean;
  parked: boolean;
  terminal: boolean;
}

export interface OrderBookProgressView {
  total: number;
  landed: number;
  drained: boolean;
  items?: OrderBookProgressItemView[];
}

export interface OrderBookFindingView {
  code: string;
  issue: string;
  message: string;
}

/** What the orders page shows for a book (PAN-5597). Derived by the server on every read, never stored. */
export type OrderBookPhase = 'draft' | 'active' | 'queued' | 'archived';

export interface OrderBookView extends OrderBook {
  /** Server-derived: the book the Flywheel works from is `active`; never re-derive it in the frontend. */
  phase: OrderBookPhase;
  /** 1-based place among queued and active books; null for draft and archived. */
  queuePosition: number | null;
  /** Every issue is terminal and the book has at least one issue. */
  finished: boolean;
  progress: OrderBookProgressView;
  validation?: { blocks: OrderBookFindingView[]; warns: OrderBookFindingView[] };
  itemReadiness?: Record<string, { hasPrd: boolean }>;
  prerequisiteTerminal?: Record<string, boolean>;
}
