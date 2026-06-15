/**
 * Tests for agents-db.ts (PAN-1908).
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: SqliteDatabase;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  upsertAgent,
  getAgent,
  listAgentsByStatusRole,
  countAgentsByRole,
  deleteAgent,
  type Agent,
} from '../../../../src/lib/database/agents-db.js';

// ============== Helpers ==============

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-test-1',
    issueId: 'PAN-1908',
    role: 'work',
    status: 'running',
    workspace: '/workspaces/feature-pan-1908',
    harness: 'claude-code',
    model: 'claude-opus-4-8',
    branch: 'feature/pan-1908',
    sessionId: null,
    startedAt: '2026-06-15T00:00:00.000Z',
    lastActivity: '2026-06-15T01:00:00.000Z',
    lastResumeAt: null,
    stoppedAt: null,
    stoppedByUser: false,
    stoppedByPause: false,
    kickoffDelivered: true,
    hostOverride: false,
    costSoFar: 1.23,
    phase: 'work',
    workType: 'implementation',
    paused: false,
    pausedReason: null,
    pausedAt: null,
    troubled: false,
    troubledAt: null,
    consecutiveFailures: 0,
    firstFailureInRunAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    lastFailureNextRetryAt: null,
    flywheelRunId: null,
    roleRunHead: null,
    reviewSubRole: null,
    reviewRunId: null,
    reviewSynthesisAgentId: null,
    reviewOutputPath: null,
    reviewDeadlineAt: null,
    reviewMonitorSignaled: null,
    reviewRetryAttempt: null,
    inspectSubRole: null,
    deliveryMethod: 'supervisor',
    supervisorEnabled: true,
    channelsEnabled: false,
    updatedAt: '2026-06-15T02:00:00.000Z',
    ...overrides,
  };
}

// ============== Tests ==============

describe('agents-db', () => {
  it('upsertAgent persists a row keyed by id and returns the stored shape', () => {
    const agent = makeAgent();
    const stored = upsertAgent(agent);

    expect(stored.id).toBe(agent.id);
    expect(stored.issueId).toBe(agent.issueId);
    expect(stored.role).toBe(agent.role);
    expect(stored.status).toBe(agent.status);
    expect(stored.workspace).toBe(agent.workspace);
    expect(stored.harness).toBe(agent.harness);
    expect(stored.model).toBe(agent.model);
    expect(stored.supervisorEnabled).toBe(true);
    expect(stored.channelsEnabled).toBe(false);
    expect(stored.updatedAt).toBe(agent.updatedAt);
  });

  it('getAgent returns the row for a known id and null for an unknown id', () => {
    upsertAgent(makeAgent({ id: 'agent-known' }));

    const found = getAgent('agent-known');
    expect(found).toBeDefined();
    expect(found?.id).toBe('agent-known');

    expect(getAgent('agent-unknown')).toBeNull();
  });

  it('listAgentsByStatusRole returns only rows matching the given status and role', () => {
    upsertAgent(makeAgent({ id: 'a1', status: 'running', role: 'work' }));
    upsertAgent(makeAgent({ id: 'a2', status: 'running', role: 'work' }));
    upsertAgent(makeAgent({ id: 'a3', status: 'stopped', role: 'work' }));
    upsertAgent(makeAgent({ id: 'a4', status: 'running', role: 'plan' }));

    const runningWork = listAgentsByStatusRole('running', 'work');
    expect(runningWork).toHaveLength(2);
    expect(runningWork.map((a) => a.id).sort()).toEqual(['a1', 'a2']);

    const stoppedWork = listAgentsByStatusRole('stopped', 'work');
    expect(stoppedWork).toHaveLength(1);
    expect(stoppedWork[0].id).toBe('a3');

    const runningPlan = listAgentsByStatusRole('running', 'plan');
    expect(runningPlan).toHaveLength(1);
    expect(runningPlan[0].id).toBe('a4');

    expect(listAgentsByStatusRole('error', 'work')).toHaveLength(0);
  });

  it('countAgentsByRole returns per-role counts', () => {
    upsertAgent(makeAgent({ id: 'c1', role: 'work' }));
    upsertAgent(makeAgent({ id: 'c2', role: 'work' }));
    upsertAgent(makeAgent({ id: 'c3', role: 'work' }));
    upsertAgent(makeAgent({ id: 'c4', role: 'plan' }));
    upsertAgent(makeAgent({ id: 'c5', role: 'review' }));

    const counts = countAgentsByRole();
    expect(counts).toEqual({
      work: 3,
      plan: 1,
      review: 1,
    });
  });

  it('upsertAgent replaces an existing row with the same id', () => {
    upsertAgent(makeAgent({ id: 'same', status: 'running', model: 'old-model' }));
    upsertAgent(makeAgent({ id: 'same', status: 'stopped', model: 'new-model' }));

    const row = getAgent('same');
    expect(row?.status).toBe('stopped');
    expect(row?.model).toBe('new-model');
  });

  it('deleteAgent removes the row', () => {
    upsertAgent(makeAgent({ id: 'to-delete' }));
    expect(getAgent('to-delete')).toBeDefined();

    deleteAgent('to-delete');
    expect(getAgent('to-delete')).toBeNull();
  });

  it('persists boolean columns as integers and reads them back as booleans', () => {
    upsertAgent(makeAgent({ id: 'bools', stoppedByUser: true, stoppedByPause: true, paused: true, troubled: true }));

    const row = getAgent('bools');
    expect(row?.stoppedByUser).toBe(true);
    expect(row?.stoppedByPause).toBe(true);
    expect(row?.paused).toBe(true);
    expect(row?.troubled).toBe(true);
    expect(row?.supervisorEnabled).toBe(true);
    expect(row?.channelsEnabled).toBe(false);
  });
});
