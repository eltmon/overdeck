import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { OrderBook } from '@overdeck/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { checkActiveOrderDispatch, recordOffBookOverride } from '../../../../src/lib/orders/dispatch-gate.js';
import { evaluateOrderDispatchEligibility } from '../../../../src/lib/orders/eligibility.js';
import type { OrderBookProgress } from '../../../../src/lib/orders/types.js';

const at = '2026-07-18T12:00:00.000Z';
const tempHomes: string[] = [];

function book(): OrderBook {
  return {
    id: '2026-07-18-campaign',
    name: 'Campaign',
    status: 'running',
    settings: { laneAConcurrency: 1, posture: 'open' },
    items: [
      { issue: 'PAN-1', lane: 'B', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-2', lane: 'B', order: 2, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-3', lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' },
      { issue: 'PAN-4', lane: 'A', order: 2, prereqs: ['PAN-3'], reVerify: false, addedAt: at, addedBy: 'operator' },
    ],
    runId: 'RUN-1',
    createdAt: at,
    updatedAt: at,
  };
}

function progress(terminals: ReadonlySet<string> = new Set()): OrderBookProgress {
  const value = book();
  const items = value.items.map((item) => ({
    issue: item.issue,
    lane: item.lane,
    order: item.order,
    closed: terminals.has(item.issue),
    parked: false,
    terminal: terminals.has(item.issue),
  }));
  return {
    bookId: value.id,
    total: items.length,
    landed: items.filter((item) => item.closed).length,
    items,
    drained: items.every((item) => item.terminal),
  };
}

afterEach(() => {
  delete process.env['OVERDECK_HOME'];
  while (tempHomes.length) rmSync(tempHomes.pop()!, { recursive: true, force: true });
});

describe('order-book dispatch eligibility', () => {
  it('blocks a second Lane B issue and names the issue occupying the serial slot', () => {
    const decision = evaluateOrderDispatchEligibility({
      book: book(),
      progress: progress(),
      issueId: 'PAN-2',
      inFlightIssues: new Set(['PAN-1']),
    });
    expect(decision).toMatchObject({
      eligible: false,
      code: 'lane-b-busy',
      message: expect.stringContaining('PAN-1 is still in flight'),
    });
  });

  it('blocks an unmet prerequisite, then admits the same issue after it becomes terminal', () => {
    const blocked = evaluateOrderDispatchEligibility({
      book: book(),
      progress: progress(),
      issueId: 'PAN-4',
      inFlightIssues: new Set(),
    });
    expect(blocked).toMatchObject({
      eligible: false,
      code: 'prerequisite-unmet',
      message: expect.stringContaining('PAN-3 has not landed or been parked'),
    });

    const eligible = evaluateOrderDispatchEligibility({
      book: book(),
      progress: progress(new Set(['PAN-3'])),
      issueId: 'PAN-4',
      inFlightIssues: new Set(),
    });
    expect(eligible.eligible).toBe(true);
  });

  it('requires --off-book for a non-member and records the accepted override in the run directory', async () => {
    const blocked = evaluateOrderDispatchEligibility({
      book: book(),
      progress: progress(),
      issueId: 'PAN-99',
      inFlightIssues: new Set(),
    });
    expect(blocked).toMatchObject({ eligible: false, code: 'off-book' });

    const overridden = evaluateOrderDispatchEligibility({
      book: book(),
      progress: progress(),
      issueId: 'PAN-99',
      inFlightIssues: new Set(),
      offBook: true,
    });
    expect(overridden).toMatchObject({ eligible: true, overrideUsed: true });

    const home = join(process.cwd(), `.test-order-override-${process.pid}`);
    tempHomes.push(home);
    process.env['OVERDECK_HOME'] = home;
    const path = await recordOffBookOverride('RUN-1', book().id, 'PAN-99', 'operator');
    expect(JSON.parse(readFileSync(path, 'utf8').trim())).toMatchObject({
      runId: 'RUN-1',
      bookId: book().id,
      issueId: 'PAN-99',
      actor: 'operator',
      override: 'off-book',
    });
  });

  it('enforces Lane A concurrency while a bookless run preserves existing dispatch behavior', async () => {
    const full = evaluateOrderDispatchEligibility({
      book: book(),
      progress: progress(new Set(['PAN-3'])),
      issueId: 'PAN-4',
      inFlightIssues: new Set(['PAN-3']),
    });
    expect(full).toMatchObject({
      eligible: false,
      code: 'lane-a-full',
      message: expect.stringContaining('laneAConcurrency is 1'),
    });

    await expect(checkActiveOrderDispatch('/project', 'PAN-4', {}, {
      resolveRunId: async () => null,
    })).resolves.toEqual({
      ordersBound: false,
      decision: { eligible: true, overrideUsed: false, conditions: [] },
    });
  });

  it('loads the active book binding and applies the same pure predicate', async () => {
    const value = book();
    const result = await checkActiveOrderDispatch('/project', 'PAN-2', {}, {
      resolveRunId: async () => 'RUN-1',
      readLaunch: async () => ({
        version: 1,
        runId: 'RUN-1',
        workspace: '/project',
        briefPath: '/project/docs/flywheel-brief.md',
        briefDisplayPath: 'docs/flywheel-brief.md',
        orders: { bookId: value.id },
      } as never),
      stateRoot: () => '/state',
      getOrderBook: () => value,
      computeProgress: () => progress(),
      inFlightIssues: () => new Set(['PAN-1']),
    });
    expect(result).toMatchObject({
      ordersBound: true,
      runId: 'RUN-1',
      bookId: value.id,
      decision: { eligible: false, code: 'lane-b-busy' },
    });
  });
});
