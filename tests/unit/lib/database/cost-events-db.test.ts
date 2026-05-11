/**
 * Tests for cost-events-db.ts query functions.
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: Database.Database;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  queryCostEvents,
  getCostsByIssueFromDb,
  getCostForIssueFromDb,
  getDailyTrends,
  getModelRollup,
  getAgentRollup,
} from '../../../../src/lib/database/cost-events-db.js';

// ============== Helpers ==============

let seq = 0;

function insertEvent(overrides: {
  agentId?: string;
  issueId?: string;
  model?: string;
  sessionType?: string;
  cost?: number;
  input?: number;
  output?: number;
  ts?: string;
  requestId?: string;
}) {
  const id = ++seq;
  testDb.prepare(`
    INSERT INTO cost_events
      (ts, agent_id, issue_id, session_type, provider, model, input, output,
       cache_read, cache_write, cost, request_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.ts ?? new Date().toISOString(),
    overrides.agentId ?? 'agent-x',
    overrides.issueId ?? 'PAN-TEST',
    overrides.sessionType ?? 'work',
    'anthropic',
    overrides.model ?? 'claude-sonnet-4-6',
    overrides.input ?? 100,
    overrides.output ?? 50,
    0,
    0,
    overrides.cost ?? 0.001,
    overrides.requestId ?? `req-${id}`,
  );
}

// ============== queryCostEvents ==============

describe('queryCostEvents', () => {
  it('returns empty array when no events', () => {
    expect(queryCostEvents()).toEqual([]);
  });

  it('returns all events when no filters applied', () => {
    insertEvent({ issueId: 'PAN-Q-1' });
    insertEvent({ issueId: 'PAN-Q-2' });
    const results = queryCostEvents();
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by issueId (case-insensitive)', () => {
    insertEvent({ issueId: 'PAN-FILTER-1' });
    insertEvent({ issueId: 'PAN-OTHER' });
    const results = queryCostEvents({ issueId: 'pan-filter-1' });
    expect(results).toHaveLength(1);
    expect(results[0].issueId).toBe('PAN-FILTER-1');
  });

  it('filters by agentId', () => {
    insertEvent({ agentId: 'my-agent', issueId: 'PAN-A1' });
    insertEvent({ agentId: 'other-agent', issueId: 'PAN-A2' });
    const results = queryCostEvents({ agentId: 'my-agent' });
    expect(results.every(r => r.agentId === 'my-agent')).toBe(true);
  });

  it('filters by startTs and endTs', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    insertEvent({ ts: past, issueId: 'PAN-T-OLD' });
    insertEvent({ ts: now, issueId: 'PAN-T-NOW' });
    const results = queryCostEvents({ startTs: now, endTs: future });
    const ids = results.map(r => r.issueId);
    expect(ids).toContain('PAN-T-NOW');
    expect(ids).not.toContain('PAN-T-OLD');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) insertEvent({ issueId: 'PAN-LIM' });
    const results = queryCostEvents({ issueId: 'PAN-LIM', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('respects offset without limit (LIMIT -1 workaround)', () => {
    for (let i = 0; i < 4; i++) insertEvent({ issueId: 'PAN-OFF' });
    const all = queryCostEvents({ issueId: 'PAN-OFF' });
    const withOffset = queryCostEvents({ issueId: 'PAN-OFF', offset: 2 });
    expect(withOffset).toHaveLength(all.length - 2);
  });

  it('respects limit and offset together', () => {
    for (let i = 0; i < 5; i++) insertEvent({ issueId: 'PAN-LO' });
    const results = queryCostEvents({ issueId: 'PAN-LO', limit: 2, offset: 1 });
    expect(results).toHaveLength(2);
  });

  it('maps row fields to CostEvent correctly', () => {
    const ts = new Date().toISOString();
    insertEvent({ ts, issueId: 'PAN-MAP', agentId: 'mapped-agent', model: 'test-model', cost: 0.0042 });
    const results = queryCostEvents({ issueId: 'PAN-MAP' });
    expect(results[0].ts).toBe(ts);
    expect(results[0].issueId).toBe('PAN-MAP');
    expect(results[0].agentId).toBe('mapped-agent');
    expect(results[0].model).toBe('test-model');
    expect(results[0].cost).toBeCloseTo(0.0042);
    expect(results[0].type).toBe('cost');
  });
});

// ============== getCostsByIssueFromDb ==============

describe('getCostsByIssueFromDb', () => {
  it('returns empty object when no events', () => {
    expect(getCostsByIssueFromDb()).toEqual({});
  });

  it('returns aggregates keyed by uppercase issueId', () => {
    insertEvent({ issueId: 'pan-agg-1', cost: 0.01, input: 200, output: 100 });
    insertEvent({ issueId: 'pan-agg-1', cost: 0.02, input: 300, output: 150 });
    insertEvent({ issueId: 'PAN-AGG-2', cost: 0.05 });
    const all = getCostsByIssueFromDb();
    expect(Object.keys(all)).toContain('PAN-AGG-1');
    expect(Object.keys(all)).toContain('PAN-AGG-2');
    expect(all['PAN-AGG-1'].totalCost).toBeCloseTo(0.03);
    expect(all['PAN-AGG-1'].inputTokens).toBe(500);
    expect(all['PAN-AGG-1'].outputTokens).toBe(250);
  });

  it('includes model and stage breakdowns', () => {
    insertEvent({ issueId: 'PAN-BD', model: 'model-a', sessionType: 'review' });
    insertEvent({ issueId: 'PAN-BD', model: 'model-b', sessionType: 'work' });
    insertEvent({ issueId: 'PAN-BD', model: 'model-c', sessionType: 'review.security' });
    const all = getCostsByIssueFromDb();
    expect(all['PAN-BD'].models).toHaveProperty('model-a');
    expect(all['PAN-BD'].models).toHaveProperty('model-b');
    expect(all['PAN-BD'].stages).toHaveProperty('review');
    expect(all['PAN-BD'].stages).toHaveProperty('work');
    expect(all['PAN-BD'].stages).toHaveProperty('review.security');
  });
});

// ============== getCostForIssueFromDb ==============

describe('getCostForIssueFromDb', () => {
  it('returns null for unknown issue', () => {
    expect(getCostForIssueFromDb('PAN-NOEXIST')).toBeNull();
  });

  it('returns aggregate for a known issue', () => {
    insertEvent({ issueId: 'PAN-SINGLE', cost: 0.007 });
    const result = getCostForIssueFromDb('PAN-SINGLE');
    expect(result).not.toBeNull();
    expect(result!.issueId).toBe('PAN-SINGLE');
    expect(result!.totalCost).toBeCloseTo(0.007);
  });

  it('is case-insensitive', () => {
    insertEvent({ issueId: 'PAN-CASE' });
    expect(getCostForIssueFromDb('pan-case')).not.toBeNull();
  });
});

// ============== getDailyTrends ==============

describe('getDailyTrends', () => {
  it('returns empty array when no events', () => {
    expect(getDailyTrends()).toEqual([]);
  });

  it('returns daily aggregates', () => {
    insertEvent({ cost: 0.01 });
    insertEvent({ cost: 0.02 });
    const trends = getDailyTrends({ days: 1 });
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0].totalCost).toBeCloseTo(0.03);
    expect(trends[0].eventCount).toBe(2);
    expect(typeof trends[0].date).toBe('string');
  });

  it('filters by issueId when provided', () => {
    insertEvent({ issueId: 'PAN-TREND-1', cost: 0.1 });
    insertEvent({ issueId: 'PAN-TREND-2', cost: 0.2 });
    const trends = getDailyTrends({ issueId: 'PAN-TREND-1' });
    expect(trends.every(t => t.totalCost < 0.15)).toBe(true);
  });
});

// ============== getModelRollup ==============

describe('getModelRollup', () => {
  it('returns empty array when no events', () => {
    expect(getModelRollup()).toEqual([]);
  });

  it('aggregates by model across all issues', () => {
    insertEvent({ model: 'model-x', cost: 0.01 });
    insertEvent({ model: 'model-x', cost: 0.02 });
    insertEvent({ model: 'model-y', cost: 0.05 });
    const rollup = getModelRollup();
    const modelX = rollup.find(r => r.model === 'model-x');
    expect(modelX).toBeDefined();
    expect(modelX!.totalCost).toBeCloseTo(0.03);
    expect(modelX!.calls).toBe(2);
  });

  it('filters by issueId when provided', () => {
    insertEvent({ issueId: 'PAN-MR-1', model: 'model-z', cost: 0.1 });
    insertEvent({ issueId: 'PAN-MR-2', model: 'model-z', cost: 0.2 });
    const rollup = getModelRollup('PAN-MR-1');
    const row = rollup.find(r => r.model === 'model-z');
    expect(row!.totalCost).toBeCloseTo(0.1);
    expect(row!.calls).toBe(1);
  });

  it('sorts by totalCost descending', () => {
    insertEvent({ model: 'cheap', cost: 0.001 });
    insertEvent({ model: 'expensive', cost: 0.1 });
    const rollup = getModelRollup();
    const costs = rollup.map(r => r.totalCost);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i - 1]).toBeGreaterThanOrEqual(costs[i]);
    }
  });
});

// ============== getAgentRollup ==============

describe('getAgentRollup', () => {
  it('returns empty array when no events', () => {
    expect(getAgentRollup()).toEqual([]);
  });

  it('aggregates by agentId', () => {
    insertEvent({ agentId: 'dev-1', cost: 0.01 });
    insertEvent({ agentId: 'dev-1', cost: 0.02 });
    insertEvent({ agentId: 'dev-2', cost: 0.05 });
    const rollup = getAgentRollup();
    const dev1 = rollup.find(r => r.agentId === 'dev-1');
    expect(dev1).toBeDefined();
    expect(dev1!.totalCost).toBeCloseTo(0.03);
    expect(dev1!.calls).toBe(2);
    expect(dev1!.firstEvent).toBeDefined();
    expect(dev1!.lastEvent).toBeDefined();
  });

  it('filters by issueId when provided', () => {
    insertEvent({ agentId: 'dev-3', issueId: 'PAN-AR-1', cost: 0.1 });
    insertEvent({ agentId: 'dev-3', issueId: 'PAN-AR-2', cost: 0.2 });
    const rollup = getAgentRollup('PAN-AR-1');
    const row = rollup.find(r => r.agentId === 'dev-3');
    expect(row!.totalCost).toBeCloseTo(0.1);
  });

  it('sorts by totalCost descending', () => {
    insertEvent({ agentId: 'cheap-dev', cost: 0.001 });
    insertEvent({ agentId: 'pricey-dev', cost: 0.1 });
    const rollup = getAgentRollup();
    const costs = rollup.map(r => r.totalCost);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i - 1]).toBeGreaterThanOrEqual(costs[i]);
    }
  });
});
