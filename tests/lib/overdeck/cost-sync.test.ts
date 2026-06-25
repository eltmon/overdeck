import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { insertCostEventSync, getTodayCostSync } from '../../../src/lib/overdeck/cost-sync.js';
import { closeOverdeckDatabaseSync } from '../../../src/lib/overdeck/infra.js';
import type { CostEvent } from '../../../src/lib/costs/events.js';

let originalOverdeckHome: string | undefined;
let testHome: string;

beforeEach(() => {
  originalOverdeckHome = process.env.OVERDECK_HOME;
  testHome = join(tmpdir(), `pan-1688-cost-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
  closeOverdeckDatabaseSync();
  if (originalOverdeckHome === undefined) {
    delete process.env.OVERDECK_HOME;
  } else {
    process.env.OVERDECK_HOME = originalOverdeckHome;
  }
  rmSync(testHome, { recursive: true, force: true });
});

function costEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    ts: '2026-06-25T12:00:00.000Z',
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.25,
    provider: 'openai',
    model: 'gpt-test',
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

describe('getTodayCostSync', () => {
  it('sums cost_events from UTC midnight only', () => {
    insertCostEventSync(costEvent({
      ts: '2026-06-24T23:59:59.999Z',
      cost: 99,
      requestId: 'previous-day',
    }));
    insertCostEventSync(costEvent({
      ts: '2026-06-25T00:00:00.000Z',
      cost: 0.4,
      requestId: 'midnight',
    }));
    insertCostEventSync(costEvent({
      ts: '2026-06-25T18:30:00.000Z',
      cost: 1.1,
      requestId: 'same-day',
    }));

    expect(getTodayCostSync(new Date('2026-06-25T23:59:00.000Z'))).toBeCloseTo(1.5, 8);
  });
});
