import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CostEvent } from '../../costs/events.js';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

function makeCostEvent(overrides: Partial<CostEvent> & { issueId: string; output: number; cost: number }): CostEvent {
  return {
    ts: new Date().toISOString(),
    type: 'cost',
    agentId: 'test-agent',
    sessionType: 'work',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    input: 1000,
    cacheRead: 0,
    cacheWrite: 0,
    ...overrides,
  };
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-caveman-exp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('getCavemanExperimentData', () => {
  it('returns empty array when no cost events exist', async () => {
    const { getCavemanExperimentData } = await import('../cost-events-db.js');
    expect(getCavemanExperimentData()).toEqual([]);
  });

  it('ignores rows with NULL caveman_variant', async () => {
    const { insertCostEvent, getCavemanExperimentData } = await import('../cost-events-db.js');
    // No cavemanVariant → stored as NULL
    insertCostEvent(makeCostEvent({ issueId: 'PAN-1', output: 500, cost: 0.01 }));
    expect(getCavemanExperimentData()).toEqual([]);
  });

  it('groups results by caveman_variant', async () => {
    const { insertCostEvent, getCavemanExperimentData } = await import('../cost-events-db.js');

    insertCostEvent(makeCostEvent({ issueId: 'PAN-1', output: 400, cost: 0.01, cavemanVariant: 'enabled', ts: '2026-01-01T00:00:01Z' }));
    insertCostEvent(makeCostEvent({ issueId: 'PAN-2', output: 600, cost: 0.02, cavemanVariant: 'enabled', ts: '2026-01-01T00:00:02Z' }));
    insertCostEvent(makeCostEvent({ issueId: 'PAN-3', output: 200, cost: 0.005, cavemanVariant: 'disabled', ts: '2026-01-01T00:00:03Z' }));

    const rows = getCavemanExperimentData();
    expect(rows).toHaveLength(2);

    const enabledRow = rows.find(r => r.variant === 'enabled');
    const disabledRow = rows.find(r => r.variant === 'disabled');

    expect(enabledRow).toBeDefined();
    expect(enabledRow!.eventCount).toBe(2);
    expect(enabledRow!.avgOutputTokens).toBe(500); // (400 + 600) / 2 = 500
    expect(enabledRow!.totalCost).toBeCloseTo(0.03, 5);

    expect(disabledRow).toBeDefined();
    expect(disabledRow!.eventCount).toBe(1);
    expect(disabledRow!.avgOutputTokens).toBe(200);
  });

  it('returns rows ordered alphabetically by variant', async () => {
    const { insertCostEvent, getCavemanExperimentData } = await import('../cost-events-db.js');

    insertCostEvent(makeCostEvent({ issueId: 'PAN-1', output: 100, cost: 0.001, cavemanVariant: 'enabled', ts: '2026-01-01T00:00:01Z' }));
    insertCostEvent(makeCostEvent({ issueId: 'PAN-2', output: 100, cost: 0.001, cavemanVariant: 'disabled', ts: '2026-01-01T00:00:02Z' }));

    const rows = getCavemanExperimentData();
    expect(rows[0].variant).toBe('disabled');  // 'd' < 'e'
    expect(rows[1].variant).toBe('enabled');
  });

  it('returned rows have all expected fields', async () => {
    const { insertCostEvent, getCavemanExperimentData } = await import('../cost-events-db.js');

    insertCostEvent(makeCostEvent({ issueId: 'PAN-1', input: 800, output: 300, cost: 0.015, cavemanVariant: 'enabled' }));

    const [row] = getCavemanExperimentData();
    expect(row).toMatchObject({
      variant: 'enabled',
      eventCount: 1,
      avgOutputTokens: 300,
      totalOutputTokens: 300,
      avgInputTokens: 800,
      avgCost: expect.any(Number),
      totalCost: expect.any(Number),
    });
  });
});

describe('caveman_variant schema', () => {
  it('caveman_variant column exists in cost_events table', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();
    const cols = db.prepare('PRAGMA table_info(cost_events)').all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('caveman_variant');
  });
});
