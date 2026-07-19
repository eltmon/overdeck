import type { OrderBook } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateOrderDispatchEligibility } from '../../../../lib/orders/eligibility.js';
import type { OrderBookProgress } from '../../../../lib/orders/types.js';
import { orderDispatchConflict } from '../agents/spawn.js';

const at = '2026-07-18T12:00:00.000Z';
const book: OrderBook = {
  id: 'active-book',
  name: 'Active campaign',
  status: 'running',
  settings: { laneAConcurrency: 2, posture: 'open' },
  items: [
    { issue: 'PAN-1', lane: 'B', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-2', lane: 'B', order: 2, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-3', lane: 'A', order: 1, prereqs: ['PAN-4'], reVerify: false, addedAt: at, addedBy: 'operator' },
    { issue: 'PAN-4', lane: 'A', order: 2, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
  ],
  runId: 'RUN-1',
  createdAt: at,
  updatedAt: at,
};
const progress: OrderBookProgress = {
  bookId: book.id,
  total: book.items.length,
  landed: 0,
  drained: false,
  items: book.items.map((item) => ({ issue: item.issue, lane: item.lane, order: item.order, closed: false, parked: false, terminal: false })),
};

describe('agent spawn order dispatch conflicts', () => {
  it('maps a second Lane B dispatch refusal to HTTP 409 with the mechanical conditions', () => {
    const decision = evaluateOrderDispatchEligibility({
      book,
      progress,
      issueId: 'PAN-2',
      inFlightIssues: new Set(['PAN-1']),
    });

    expect(orderDispatchConflict(decision)).toMatchObject({
      status: 409,
      body: {
        code: 'lane-b-busy',
        error: expect.stringContaining('PAN-1 is still in flight'),
        conditions: expect.arrayContaining([expect.objectContaining({ key: 'lane-slot', met: false })]),
      },
    });
  });

  it('maps an unmet prerequisite refusal to HTTP 409 and returns null for an eligible dispatch', () => {
    const blocked = evaluateOrderDispatchEligibility({ book, progress, issueId: 'PAN-3', inFlightIssues: new Set() });
    expect(orderDispatchConflict(blocked)).toMatchObject({
      status: 409,
      body: {
        code: 'prerequisite-unmet',
        error: expect.stringContaining('PAN-4 has not landed or been parked'),
      },
    });

    const terminalProgress = {
      ...progress,
      items: progress.items.map((item) => item.issue === 'PAN-4' ? { ...item, closed: true, terminal: true } : item),
    };
    const eligible = evaluateOrderDispatchEligibility({ book, progress: terminalProgress, issueId: 'PAN-3', inFlightIssues: new Set() });
    expect(orderDispatchConflict(eligible)).toBeNull();
  });
});
