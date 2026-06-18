import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  saveOverdeckAgentStateSync,
  getOverdeckAgentStateSync,
  listOverdeckAgentStatesSync,
  type OverdeckTestDb,
} from '../../helpers/overdeck-test-db.js';
import type { AgentState } from '../../../src/lib/agents.js';

describe('overdeck test fixture', () => {
  let odb: OverdeckTestDb;

  beforeEach(() => {
    odb = setupOverdeckTestDb();
  });

  afterEach(() => {
    teardownOverdeckTestDb(odb);
  });

  const sampleAgent = (id: string): AgentState => ({
    id,
    issueId: 'PAN-9999',
    workspace: '/tmp/ws',
    role: 'work',
    model: 'claude-opus-4-8',
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  it('points PANOPTICON_HOME at the temp home and creates overdeck.db there', () => {
    expect(process.env.PANOPTICON_HOME).toBe(odb.home);
    expect(odb.dbPath).toContain(odb.home);
  });

  it('round-trips an agent through the real overdeck.db', () => {
    expect(getOverdeckAgentStateSync('agent-x')).toBeNull();

    saveOverdeckAgentStateSync(sampleAgent('agent-x'));

    const got = getOverdeckAgentStateSync('agent-x');
    expect(got?.id).toBe('agent-x');
    expect(got?.issueId).toBe('PAN-9999');
    expect(got?.status).toBe('running');
    expect(listOverdeckAgentStatesSync().map((a) => a.id)).toContain('agent-x');
  });

  it('isolates state between tests — no bleed from the prior test', () => {
    // 'agent-x' was written in the previous test against a different temp db.
    expect(getOverdeckAgentStateSync('agent-x')).toBeNull();
    expect(listOverdeckAgentStatesSync()).toHaveLength(0);
  });
});
