/**
 * backfillUnknownOrderIssues (PAN-5599 WI-3): ask the tracker for every issue
 * of a ready/running book the issue cache does not hold, so a book whose
 * issues closed outside the closed window still reads as finished.
 */
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backfillUnknownOrderIssues, type OrderIssueBackfillService } from '../../../../src/lib/orders/resolver.js';

const at = '2026-11-23T05:00:00.000Z';

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

function fakeService(overrides: Partial<OrderIssueBackfillService> = {}): OrderIssueBackfillService {
  return {
    isStarted: () => true,
    issueIds: () => new Set(['PAN-1']),
    backfillIssue: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('backfillUnknownOrderIssues', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('backfills exactly the uncached issues of ready and running books', async () => {
    const backfillIssue = vi.fn(async () => {});
    const service = fakeService({ issueIds: () => new Set(['PAN-1']), backfillIssue });

    await backfillUnknownOrderIssues(
      [book('r', 'ready', ['PAN-1', 'PAN-2']), book('d', 'draft', ['PAN-3']), book('x', 'complete', ['PAN-4'])],
      { service },
    );

    expect(backfillIssue).toHaveBeenCalledTimes(1);
    expect(backfillIssue).toHaveBeenCalledWith('PAN-2');
  });

  it('does nothing when the service is not started', async () => {
    const backfillIssue = vi.fn(async () => {});
    const service = fakeService({ isStarted: () => false, backfillIssue });

    await backfillUnknownOrderIssues([book('r', 'ready', ['PAN-2'])], { service });

    expect(backfillIssue).not.toHaveBeenCalled();
  });

  it('does nothing when the service holds no issues', async () => {
    const backfillIssue = vi.fn(async () => {});
    const service = fakeService({ issueIds: () => new Set(), backfillIssue });

    await backfillUnknownOrderIssues([book('r', 'ready', ['PAN-2'])], { service });

    expect(backfillIssue).not.toHaveBeenCalled();
  });

  it('returns after timeoutMs when a backfill never settles', async () => {
    const backfillIssue = vi.fn(() => new Promise<void>(() => {}));
    const service = fakeService({ issueIds: () => new Set(['PAN-1']), backfillIssue });

    const resultPromise = backfillUnknownOrderIssues([book('r', 'ready', ['PAN-1', 'PAN-2'])], {
      service,
      timeoutMs: 3000,
    });
    let settled = false;
    resultPromise.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await resultPromise;
    expect(settled).toBe(true);
  });

  it('a rejected backfill does not throw', async () => {
    const backfillIssue = vi.fn(async () => { throw new Error('tracker unreachable'); });
    const service = fakeService({ issueIds: () => new Set(['PAN-1']), backfillIssue });

    await expect(backfillUnknownOrderIssues([book('r', 'ready', ['PAN-2'])], { service })).resolves.toBeUndefined();
  });
});
