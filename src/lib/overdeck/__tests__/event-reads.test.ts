import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import {
  listAgentRuntimeEventEvidenceSync,
  readLatestAgentClaudeSessionIdEventSync,
} from '../event-reads.js';

function insertEvent(
  odb: OverdeckTestDb,
  type: 'agent.created' | 'agent.model_set',
  sequenceTimestamp: number,
  payload: Record<string, unknown>,
): void {
  odb.raw().prepare(`
    INSERT INTO events (type, timestamp, payload)
    VALUES (?, ?, ?)
  `).run(type, sequenceTimestamp, JSON.stringify(payload));
}

function insertModelSet(
  odb: OverdeckTestDb,
  sequenceTimestamp: number,
  payload: Record<string, unknown>,
): void {
  insertEvent(odb, 'agent.model_set', sequenceTimestamp, payload);
}

describe('agent event read door', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  }, 20_000);

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('returns the latest retained session id for one agent', () => {
    insertModelSet(odb, 1, { agentId: 'agent-min-839', claudeSessionId: 'older-session' });
    insertModelSet(odb, 2, { agentId: 'agent-other', claudeSessionId: 'other-session' });
    insertModelSet(odb, 3, { agentId: 'agent-min-839', model: 'claude-opus-5' });
    insertModelSet(odb, 4, { agentId: 'agent-min-839', claudeSessionId: 'newer-session' });

    expect(readLatestAgentClaudeSessionIdEventSync('agent-min-839')).toBe('newer-session');
  });

  it('honors an explicit session clear instead of resurrecting an older id', () => {
    insertModelSet(odb, 1, { agentId: 'agent-min-839', claudeSessionId: 'older-session' });
    insertModelSet(odb, 2, { agentId: 'agent-min-839', claudeSessionId: null });

    expect(readLatestAgentClaudeSessionIdEventSync('agent-min-839')).toBeNull();
  });

  it('reconstructs retained identity and post-clear session history', () => {
    insertEvent(odb, 'agent.created', 1, {
      agentId: 'agent-min-839',
      issueId: 'MIN-839',
      agent: {
        issueId: 'MIN-839',
        role: 'work',
        workspace: '/work/myn/workspaces/feature-min-839',
        model: 'claude-opus-5',
        branch: 'feature/min-839',
        startedAt: '2026-08-01T10:58:11.000Z',
      },
    });
    insertModelSet(odb, 2, { agentId: 'agent-min-839', claudeSessionId: 'cleared-session' });
    insertModelSet(odb, 3, { agentId: 'agent-min-839', claudeSessionId: null });
    insertModelSet(odb, 4, { agentId: 'agent-min-839', claudeSessionId: 'recovered-session' });

    expect(listAgentRuntimeEventEvidenceSync()).toEqual([{
      agentId: 'agent-min-839',
      issueId: 'MIN-839',
      role: 'work',
      workspace: '/work/myn/workspaces/feature-min-839',
      model: 'claude-opus-5',
      branch: 'feature/min-839',
      startedAt: '2026-08-01T10:58:11.000Z',
      sessions: [{
        id: 'recovered-session',
        startedAt: new Date(4).toISOString(),
      }],
    }]);
  });
});
