import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AgentSnapshot } from '@overdeck/contracts';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  saveOverdeckAgentStateSync,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';

// ============== Overdeck DB fixture ==============

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

// ============== Imports (after fixture is set up) ==============

import {
  getClosedIssueIdsForReadSource,
  pruneAgentsForReadSource,
} from '../read-model.js';
import type { AgentState } from '../../../lib/agents.js';

function baseAgent(id: string, issueId: string, role: AgentState['role'] = 'work'): AgentState {
  return {
    id,
    issueId,
    role,
    status: 'stopped',
    workspace: '/workspaces/feature-pan-1908',
    harness: 'claude-code',
    model: 'claude-opus-4-8',
    startedAt: '2026-05-23T00:00:00.000Z',
    stoppedAt: '2026-05-23T01:00:00.000Z',
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
    saveOverdeckAgentStateSync(baseAgent('agent-pan-1419-live', 'PAN-1419'));

    const pruned = pruneAgentsForReadSource({
      'agent-pan-1419-live': agent('agent-pan-1419-live', 'PAN-1419'),
      'agent-pan-1132-stale': agent('agent-pan-1132-stale', 'PAN-1132'),
    }, []);

    expect(Object.keys(pruned.agentsById)).toEqual(['agent-pan-1419-live']);
    expect(pruned.prunedCount).toBe(1);
  });

  it('drops agents for closed issues even when their agents table row still exists', () => {
    saveOverdeckAgentStateSync(baseAgent('agent-pan-1331-closed', 'PAN-1331'));
    saveOverdeckAgentStateSync(baseAgent('agent-pan-1419-active', 'PAN-1419'));

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
    saveOverdeckAgentStateSync(baseAgent('strike-pan-1506', 'PAN-1506', 'strike'));
    saveOverdeckAgentStateSync(baseAgent('planning-pan-1234', 'PAN-1234', 'plan'));
    saveOverdeckAgentStateSync(baseAgent('agent-pan-1419', 'PAN-1419', 'work'));

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
