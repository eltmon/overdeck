import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentSnapshot } from '@panctl/contracts';
import { openDatabase, type SqliteDatabase } from '../../../lib/database/driver.js';
import { initSchema } from '../../../lib/database/schema.js';
import type { Agent } from '../../../lib/database/agents-db.js';

// ============== In-memory DB injection ==============

let testDb: SqliteDatabase;

vi.mock('../../../lib/database/index.js', () => ({
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
  getClosedIssueIdsForReadSource,
  pruneAgentsForReadSource,
} from '../read-model.js';
import { upsertAgent } from '../../../lib/database/agents-db.js';

function baseAgent(id: string, issueId: string, role = 'work'): Agent {
  return {
    id,
    issueId,
    role,
    status: 'stopped',
    workspace: '/workspaces/feature-pan-1908',
    harness: 'claude-code',
    model: 'claude-opus-4-8',
    branch: null,
    sessionId: null,
    startedAt: '2026-05-23T00:00:00.000Z',
    lastActivity: null,
    lastResumeAt: null,
    stoppedAt: '2026-05-23T01:00:00.000Z',
    stoppedByUser: false,
    stoppedByPause: false,
    kickoffDelivered: false,
    hostOverride: false,
    costSoFar: null,
    phase: null,
    workType: null,
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
    deliveryMethod: null,
    supervisorEnabled: false,
    channelsEnabled: false,
    updatedAt: new Date().toISOString(),
  };
}

function agent(id: string, issueId: string, role?: AgentSnapshot['role']): AgentSnapshot {
  return {
    id,
    issueId,
    status: 'stopped',
    startedAt: '2026-05-23T00:00:00.000Z',
    ...(role ? { role } : {}),
  };
}

describe('read model agent source pruning', () => {
  it('detects closed issue ids from tracker-shaped issue rows', () => {
    expect(getClosedIssueIdsForReadSource([
      { identifier: 'PAN-1132', state: 'CLOSED' },
      { identifier: 'PAN-1331', canonicalStatus: 'done' },
      { identifier: 'PAN-1419', canonicalStatus: 'in_progress' },
    ])).toEqual(new Set(['PAN-1132', 'PAN-1331']));
  });

  it('drops cached agents whose row no longer exists in the agents table', () => {
    upsertAgent(baseAgent('agent-pan-1419-live', 'PAN-1419'));

    const pruned = pruneAgentsForReadSource({
      'agent-pan-1419-live': agent('agent-pan-1419-live', 'PAN-1419'),
      'agent-pan-1132-stale': agent('agent-pan-1132-stale', 'PAN-1132'),
    }, []);

    expect(Object.keys(pruned.agentsById)).toEqual(['agent-pan-1419-live']);
    expect(pruned.prunedCount).toBe(1);
  });

  it('drops agents for closed issues even when their agents table row still exists', () => {
    upsertAgent(baseAgent('agent-pan-1331-closed', 'PAN-1331'));
    upsertAgent(baseAgent('agent-pan-1419-active', 'PAN-1419'));

    const pruned = pruneAgentsForReadSource({
      'agent-pan-1331-closed': agent('agent-pan-1331-closed', 'PAN-1331'),
      'agent-pan-1419-active': agent('agent-pan-1419-active', 'PAN-1419'),
    }, [
      { identifier: 'PAN-1331', status: 'done' },
      { identifier: 'PAN-1419', status: 'in_progress' },
    ]);

    expect(Object.keys(pruned.agentsById)).toEqual(['agent-pan-1419-active']);
    expect(pruned.prunedCount).toBe(1);
  });

  // PAN-1506 regression. The root cause (strikes invisible on the Agents page)
  // was upstream — isRole()/toRole() dropped role='strike' before it reached
  // agentsById. Those guards are covered in tests/lib/agents-strike-role-parse
  // and tests/dashboard/read-model-validators. This test guards the *other*
  // end: pruneAgentsForReadSource is the only agent-membership filter the
  // snapshot read path (getSnapshot) applies, and it must never drop an agent
  // based on its role prefix. If a future change ever filters the read source
  // by role, strikes would silently vanish from the snapshot again.
  it('keeps strike, planning, and work agents in the read source (role parity)', () => {
    upsertAgent({ ...baseAgent('strike-pan-1506', 'PAN-1506'), role: 'strike' });
    upsertAgent({ ...baseAgent('planning-pan-1234', 'PAN-1234'), role: 'plan' });
    upsertAgent({ ...baseAgent('agent-pan-1419', 'PAN-1419'), role: 'work' });

    const pruned = pruneAgentsForReadSource({
      'strike-pan-1506': agent('strike-pan-1506', 'PAN-1506', 'strike'),
      'planning-pan-1234': agent('planning-pan-1234', 'PAN-1234', 'plan'),
      'agent-pan-1419': agent('agent-pan-1419', 'PAN-1419', 'work'),
    }, [
      { identifier: 'PAN-1506', status: 'in_progress' },
      { identifier: 'PAN-1234', status: 'in_progress' },
      { identifier: 'PAN-1419', status: 'in_progress' },
    ]);

    expect(Object.keys(pruned.agentsById).sort()).toEqual([
      'agent-pan-1419',
      'planning-pan-1234',
      'strike-pan-1506',
    ]);
    expect(pruned.agentsById['strike-pan-1506']?.role).toBe('strike');
    expect(pruned.agentsById['planning-pan-1234']?.role).toBe('plan');
    expect(pruned.agentsById['agent-pan-1419']?.role).toBe('work');
    expect(pruned.prunedCount).toBe(0);
  });
});
