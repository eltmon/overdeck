import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import { reclassifyUnknownCostEventsSync } from '../attribution.js';

interface CostEventRow {
  id: number;
  issue_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  session_type: string | null;
  provider: string | null;
  model: string | null;
  input: number | null;
  output: number | null;
  cache_read: number | null;
  cache_write: number | null;
  cost: number | null;
  request_id: string | null;
  source_file: string | null;
}

describe('reclassifyUnknownCostEventsSync', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  it('reclassifies UNKNOWN rows once and preserves non-UNKNOWN rows', () => {
    seedConversation(odb, {
      id: 'conv-uuid-launch',
      name: 'launch-video',
      tmuxSession: 'conv-launch-video',
      locator: 'session-launch',
    });
    seedConversation(odb, {
      id: 'conv-uuid-flywheel',
      name: 'flywheel-orchestrator',
      tmuxSession: 'conv-flywheel-orchestrator',
      locator: 'session-flywheel',
    });
    seedConversation(odb, {
      id: 'conv-uuid-operator',
      name: 'operator-chat',
      tmuxSession: 'conv-operator-chat',
      locator: 'session-operator',
    });
    seedCostEvent(odb, { issueId: 'UNKNOWN', requestId: 'req-launch', sessionId: 'session-launch', agentId: 'agent-pan-1' });
    seedCostEvent(odb, { issueId: 'UNKNOWN', requestId: 'req-flywheel', sessionId: 'session-flywheel', agentId: 'agent-pan-2' });
    seedCostEvent(odb, { issueId: 'UNKNOWN', requestId: 'req-none', sessionId: 'session-none', agentId: 'agent-pan-3' });
    seedCostEvent(odb, { issueId: 'UNKNOWN', requestId: 'req-null-session', sessionId: null, agentId: 'conv-operator-chat' });
    seedCostEvent(odb, { issueId: 'UNKNOWN', requestId: 'req-null-session-two', sessionId: null, agentId: 'conv-operator-chat' });
    seedCostEvent(odb, { issueId: 'PAN-1', requestId: 'req-pan', sessionId: 'session-launch', agentId: 'agent-pan-4' });
    seedCostEvent(odb, { issueId: 'sequencer-runner', requestId: 'req-sequencer', sessionId: 'session-none', agentId: 'agent-pan-5' });
    const beforeSentinels = readRows(odb).filter((row) => row.issue_id !== 'UNKNOWN');

    expect(reclassifyUnknownCostEventsSync()).toEqual({ updated: 5 });

    const rows = readRows(odb);
    expect(rows.filter((row) => row.issue_id === 'UNKNOWN')).toEqual([]);
    expect(issueByRequest(rows, 'req-launch')).toBe('CONVERSATIONS');
    expect(issueByRequest(rows, 'req-flywheel')).toBe('FLYWHEEL');
    expect(issueByRequest(rows, 'req-none')).toBe('UNATTRIBUTED');
    expect(issueByRequest(rows, 'req-null-session')).toBe('CONVERSATIONS');
    expect(issueByRequest(rows, 'req-null-session-two')).toBe('CONVERSATIONS');
    expect(rows.filter((row) => row.issue_id === 'PAN-1' || row.issue_id === 'sequencer-runner')).toEqual(beforeSentinels);

    expect(reclassifyUnknownCostEventsSync()).toEqual({ updated: 0 });
    expect(readRows(odb)).toEqual(rows);
  });
});

function seedConversation(
  odb: OverdeckTestDb,
  input: { id: string; name: string; tmuxSession: string; locator: string },
): void {
  const now = Date.parse('2026-07-06T00:00:00.000Z');
  odb.raw()
    .prepare(
      `INSERT INTO conversations (id, name, tmux_session, status, cwd, created_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run(input.id, input.name, input.tmuxSession, '/home/eltmon/project', now);
  odb.raw()
    .prepare(
      `INSERT INTO conversation_files (conversation_id, harness, locator, created_at)
       VALUES (?, 'codex', ?, ?)`,
    )
    .run(input.id, input.locator, now);
}

function seedCostEvent(
  odb: OverdeckTestDb,
  input: { issueId: string; requestId: string; sessionId: string | null; agentId: string },
): void {
  odb.raw()
    .prepare(
      `INSERT INTO cost_events (
        ts, agent_id, issue_id, session_type, provider, model,
        input, output, cache_read, cache_write, cost, request_id, source_file, session_id
      )
      VALUES (?, ?, ?, 'work', 'anthropic', 'claude-haiku-4-5', 100, 20, 0, 0, 0.01, ?, ?, ?)`,
    )
    .run(
      Date.parse('2026-07-06T00:00:00.000Z'),
      input.agentId,
      input.issueId,
      input.requestId,
      `/tmp/${input.requestId}.jsonl`,
      input.sessionId,
    );
}

function readRows(odb: OverdeckTestDb): CostEventRow[] {
  return odb.raw().prepare('SELECT * FROM cost_events ORDER BY id').all() as CostEventRow[];
}

function issueByRequest(rows: CostEventRow[], requestId: string): string | null | undefined {
  return rows.find((row) => row.request_id === requestId)?.issue_id;
}
