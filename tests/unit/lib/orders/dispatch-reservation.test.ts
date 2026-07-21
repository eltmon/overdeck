import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withActiveOrderDispatchReservation } from '../../../../src/lib/orders/dispatch-reservation.js';
import type { OrderBookProgress } from '../../../../src/lib/orders/types.js';

const at = '2026-07-18T12:00:00.000Z';

function book(laneAConcurrency = 2): OrderBook {
  return {
    id: '2026-07-18-campaign',
    name: 'Campaign',
    status: 'running',
    settings: { laneAConcurrency, posture: 'open' },
    items: [
      { issue: 'PAN-B1', lane: 'B', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-B2', lane: 'B', order: 2, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-A1', lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-A2', lane: 'A', order: 2, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-A3', lane: 'A', order: 3, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
    ],
    runId: 'RUN-1',
    createdAt: at,
    updatedAt: at,
  };
}

function progress(value: OrderBook): OrderBookProgress {
  return {
    bookId: value.id,
    total: value.items.length,
    landed: 0,
    drained: false,
    items: value.items.map((item) => ({
      issue: item.issue,
      lane: item.lane,
      order: item.order,
      closed: false,
      parked: false,
      terminal: false,
    })),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('order dispatch reservations', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pan-order-reservation-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function deps(value: OrderBook) {
    return {
      reservationRoot: () => root,
      resolveRunId: async () => 'RUN-1',
      readLaunch: async () => ({
        version: 1 as const,
        runId: 'RUN-1',
        workspace: '/project',
        briefPath: '/project/docs/flywheel-brief.md',
        briefDisplayPath: 'docs/flywheel-brief.md',
        orders: { bookId: value.id },
      }),
      stateRoot: () => '/state',
      getOrderBook: () => value,
      computeProgress: () => progress(value),
      issueLookup: () => new Map(),
      inFlightIssues: () => new Set<string>(),
    };
  }

  it('rejects a simultaneous second Lane B admission while the first reservation is held', async () => {
    const value = book();
    const started = deferred();
    const finish = deferred();
    const first = withActiveOrderDispatchReservation('/project', 'PAN-B1', {}, async () => {
      started.resolve();
      await finish.promise;
      return 'spawned';
    }, deps(value));
    await started.promise;

    const secondAction = vi.fn(async () => 'should-not-spawn');
    const second = await withActiveOrderDispatchReservation('/project', 'PAN-B2', {}, secondAction, deps(value));

    expect(second.check.decision).toMatchObject({ eligible: false, code: 'lane-b-busy' });
    expect(secondAction).not.toHaveBeenCalled();
    finish.resolve();
    await expect(first).resolves.toMatchObject({ result: 'spawned' });
  });

  it('admits concurrent Lane A starts up to the configured boundary and rejects the next', async () => {
    const value = book(2);
    const startedOne = deferred();
    const startedTwo = deferred();
    const finish = deferred();
    const first = withActiveOrderDispatchReservation('/project', 'PAN-A1', {}, async () => {
      startedOne.resolve();
      await finish.promise;
      return 'one';
    }, deps(value));
    const second = withActiveOrderDispatchReservation('/project', 'PAN-A2', {}, async () => {
      startedTwo.resolve();
      await finish.promise;
      return 'two';
    }, deps(value));
    await Promise.all([startedOne.promise, startedTwo.promise]);

    const thirdAction = vi.fn(async () => 'three');
    const third = await withActiveOrderDispatchReservation('/project', 'PAN-A3', {}, thirdAction, deps(value));

    expect(third.check.decision).toMatchObject({ eligible: false, code: 'lane-a-full' });
    expect(thirdAction).not.toHaveBeenCalled();
    finish.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ result: 'one' }),
      expect.objectContaining({ result: 'two' }),
    ]);
  });
});
