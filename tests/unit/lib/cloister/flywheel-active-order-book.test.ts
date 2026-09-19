/**
 * Which issues the current order book covers (PAN-3917 D12).
 *
 * The book used to be named by the active flywheel run's launch metadata, read
 * back from a run record. Run records are deleted; the order-book queue in the
 * repo's plan home answers the question by itself.
 */
import type { OrderBook } from '@overdeck/contracts';
import { describe, expect, it, vi } from 'vitest';

import { activeOrderBookIssues, currentOrderBook } from '../../../../src/lib/cloister/flywheel.js';

const at = '2026-07-18T12:00:00.000Z';

function book(id: string, status: OrderBook['status'], issues: string[]): OrderBook {
  return {
    id,
    name: id,
    status,
    settings: { laneAConcurrency: 1, posture: 'open' },
    items: issues.map((issue, index) => ({
      issue,
      lane: 'A' as const,
      order: index + 1,
      prereqs: [],
      reVerify: false,
      addedAt: at,
      addedBy: 'operator',
    })),
    createdAt: at,
    updatedAt: at,
  };
}

describe('currentOrderBook', () => {
  it('prefers the running book over draft and ready siblings', () => {
    expect(currentOrderBook([
      book('draft', 'draft', ['PAN-10']),
      book('running', 'running', ['PAN-20']),
      book('ready', 'ready', ['PAN-30']),
    ])?.id).toBe('running');
  });

  it('falls back to the next ready book when nothing is running', () => {
    expect(currentOrderBook([
      book('draft', 'draft', ['PAN-10']),
      book('ready', 'ready', ['PAN-30']),
    ])?.id).toBe('ready');
  });

  it('never picks a draft book — a draft is not dispatchable', () => {
    expect(currentOrderBook([book('draft', 'draft', ['PAN-10'])])).toBeNull();
  });
});

describe('activeOrderBookIssues', () => {
  it('returns the issues of the running book, read from the plan home', async () => {
    const listBooks = vi.fn(() => [
      book('draft', 'draft', ['PAN-10']),
      book('running', 'running', ['PAN-20']),
      book('ready', 'ready', ['PAN-30']),
    ]);

    await expect(activeOrderBookIssues('/project', { planHome: () => '/plan-home', listBooks }))
      .resolves.toEqual(new Set(['PAN-20']));
    expect(listBooks).toHaveBeenCalledWith('/plan-home');
  });

  it('returns no membership when the queue holds nothing dispatchable', async () => {
    await expect(activeOrderBookIssues('/project', {
      planHome: () => '/plan-home',
      listBooks: () => [book('draft', 'draft', ['PAN-10'])],
    })).resolves.toEqual(new Set());
  });
});
