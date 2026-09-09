import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  insertCostEventSync,
  getTodayCostSync,
  getCostsByIssueSync,
  getCostForIssueAggregateSync,
  getAgentCostStatsSync,
  queryCostEventsSync,
} from '../../../src/lib/overdeck/cost-sync.js';
import { buildAgentStatsSnapshot } from '../../../src/dashboard/server/routes/resources/agents-stats.js';
import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../../../src/lib/overdeck/infra.js';
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

describe('getCostsByIssueSync', () => {
  it('aggregates totals with per-model and per-stage breakdowns, case-folding issue ids (PAN-472)', () => {
    insertCostEventSync(costEvent({
      issueId: 'pan-9', sessionType: 'work', model: 'gpt-test', cost: 1,
      input: 100, output: 50, requestId: 'a1',
    }));
    insertCostEventSync(costEvent({
      issueId: 'PAN-9', sessionType: 'work', model: 'gpt-test', cost: 2,
      input: 200, output: 100, requestId: 'a2',
    }));
    insertCostEventSync(costEvent({
      issueId: 'PAN-9', sessionType: 'review', model: 'claude-test', cost: 4,
      input: 10, output: 5, requestId: 'a3',
    }));
    insertCostEventSync(costEvent({
      issueId: 'PAN-10', sessionType: 'planning', model: 'gpt-test', cost: 8,
      input: 1, output: 1, requestId: 'b1',
    }));

    const result = getCostsByIssueSync();

    // 'pan-9' and 'PAN-9' fold into one issue.
    expect(Object.keys(result).sort()).toEqual(['PAN-10', 'PAN-9']);
    expect(result['PAN-9'].totalCost).toBeCloseTo(7, 8);
    expect(result['PAN-9'].inputTokens).toBe(310);
    expect(result['PAN-9'].outputTokens).toBe(155);
    expect(result['PAN-9'].models['gpt-test']).toEqual({ cost: 3, calls: 2, tokens: 450 });
    expect(result['PAN-9'].models['claude-test']).toEqual({ cost: 4, calls: 1, tokens: 15 });
    expect(result['PAN-9'].stages['work']).toEqual({ cost: 3, calls: 2, tokens: 450 });
    expect(result['PAN-9'].stages['review']).toEqual({ cost: 4, calls: 1, tokens: 15 });
    expect(result['PAN-10'].totalCost).toBeCloseTo(8, 8);
    expect(result['PAN-10'].models['gpt-test']).toEqual({ cost: 8, calls: 1, tokens: 2 });
    expect(result['PAN-10'].stages['planning']).toEqual({ cost: 8, calls: 1, tokens: 2 });
  });

  it('returns provider totals that sum to the issue total', () => {
    insertCostEventSync(costEvent({
      issueId: 'pan-42', provider: 'openai', sessionType: 'work', model: 'gpt-test', cost: 1.25,
      input: 100, output: 50, requestId: 'provider-openai',
    }));
    insertCostEventSync(costEvent({
      issueId: 'PAN-42', provider: 'anthropic', sessionType: 'review', model: 'claude-test', cost: 2.75,
      input: 200, output: 100, requestId: 'provider-anthropic',
    }));
    insertRawCostEventWithNullProvider({
      issueId: 'PAN-42',
      cost: 0.5,
      requestId: 'provider-null',
    });

    const result = getCostForIssueAggregateSync('pan-42');

    expect(result).not.toBeNull();
    expect(result!.totalCost).toBeCloseTo(4.5, 8);
    expect(result!.providers).toEqual({
      anthropic: 2.75,
      openai: 1.25,
      unknown: 0.5,
    });
    expect(Object.values(result!.providers).reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(result!.totalCost, 8);
    expect(Object.values(result!.models).reduce((sum, model) => sum + model.cost, 0)).toBeCloseTo(result!.totalCost, 8);
  });
});

function insertRawCostEventWithNullProvider(input: { issueId: string; cost: number; requestId: string }): void {
  getOverdeckDatabaseSync()
    .prepare(
      `INSERT INTO cost_events (
        ts, agent_id, issue_id, session_type, provider, model,
        input, output, cache_read, cache_write, cost, request_id, source_file, session_id
      )
      VALUES (?, 'agent-pan-42', ?, 'work', NULL, 'unknown-provider-model', 10, 5, 0, 0, ?, ?, NULL, 'session-provider-null')`,
    )
    .run(Date.parse('2026-06-25T12:00:00.000Z'), input.issueId, input.cost, input.requestId);
}

describe('agent resource cost aggregates', () => {
  it('preserves the entire event-based resource response with grouped SQL totals', () => {
    const nowMs = Date.parse('2026-06-25T12:00:00.000Z');
    const fixtures = [
      { agentId: 'agent-a', ageMs: 30 * 60_000 + 1, cost: 1 },
      { agentId: 'agent-a', ageMs: 30 * 60_000, cost: 0.5 },
      { agentId: 'agent-a', ageMs: 60_000, cost: 0.255 },
      { agentId: 'agent-a', ageMs: -60_000, cost: 0.2 },
      { agentId: 'agent-a', ageMs: 30 * 60_000 + 1, cost: 5, source: 'subscription-covered' },
      { agentId: 'agent-a', ageMs: 30 * 60_000, cost: 0.125, source: 'subscription-covered' },
      { agentId: 'agent-b', ageMs: 60_000, cost: 0 },
      { agentId: 'unrelated', ageMs: 60_000, cost: 90 },
    ];
    fixtures.forEach((fixture, index) => insertCostEventSync(costEvent({
      ...fixture, ts: new Date(nowMs - fixture.ageMs).toISOString(), requestId: `agent-aggregate-${index}`,
    })));
    const agentIds = ['agent-a', 'agent-b', 'agent-empty'];
    const options = {
      nowMs,
      agents: agentIds.map(id => ({ id, issueId: 'PAN-1', role: 'work' as const, model: 'fixture',
        status: 'running' as const, startedAt: new Date(nowMs - 3_600_000).toISOString() })),
      sessionRoots: [{ agentId: 'agent-a', rootPid: 123 }],
      processes: [{ pid: 123, ppid: 1, cpuPercent: 1.5, rssBytes: 1024 }],
    };
    const aggregates = getAgentCostStatsSync({ agentIds, nowMs });
    const before = buildAgentStatsSnapshot({ ...options,
      costEventsByAgent: new Map(agentIds.map(agentId => [agentId, queryCostEventsSync({ agentId })])),
    });
    expect(buildAgentStatsSnapshot({ ...options, costStatsByAgent: new Map(aggregates) })).toEqual(before);
    expect(new Map(aggregates).get('agent-a')).toEqual({
      burnUsdPerHour: 1.91, hypotheticalUsdPerHour: 0.25, totalUsd: 1.96,
    });
    expect(aggregates).toHaveLength(2);
    expect(before.agents[1]).not.toHaveProperty('hypotheticalUsdPerHour');
  });

  it('returns no aggregates for an empty fleet or missing ledger history', () => {
    expect(getAgentCostStatsSync({ agentIds: [], nowMs: 0 })).toEqual([]);
    expect(getAgentCostStatsSync({ agentIds: ['missing'], nowMs: 0 })).toEqual([]);
  });
});
