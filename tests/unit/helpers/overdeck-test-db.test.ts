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

  it('points OVERDECK_HOME at the temp home and creates overdeck.db there', () => {
    expect(process.env.OVERDECK_HOME).toBe(odb.home);
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

  it('round-trips the restored lifecycle columns (parity: stoppedAt, costSoFar, reviewRunId, …)', () => {
    saveOverdeckAgentStateSync({
      id: 'agent-restored',
      issueId: 'PAN-9999',
      workspace: '/tmp/ws',
      role: 'review',
      model: 'claude-opus-4-8',
      status: 'stopped',
      startedAt: '2026-06-17T00:00:00.000Z',
      stoppedAt: '2026-06-17T01:00:00.000Z',
      pausedAt: '2026-06-17T00:30:00.000Z',
      troubledAt: '2026-06-17T00:45:00.000Z',
      lastActivity: '2026-06-17T00:50:00.000Z',
      lastFailureReason: 'boom',
      phase: 'review-response',
      roleRunHead: 'abc123',
      flywheelRunId: 'fw-1',
      costSoFar: 1.2345,
      reviewSubRole: 'security',
      reviewRunId: 'run-7',
    } as AgentState);

    const got = getOverdeckAgentStateSync('agent-restored');
    expect(got?.stoppedAt).toBe('2026-06-17T01:00:00.000Z');
    expect(got?.pausedAt).toBe('2026-06-17T00:30:00.000Z');
    expect(got?.troubledAt).toBe('2026-06-17T00:45:00.000Z');
    expect(got?.lastActivity).toBe('2026-06-17T00:50:00.000Z');
    expect(got?.lastFailureReason).toBe('boom');
    expect(got?.phase).toBe('review-response');
    expect(got?.roleRunHead).toBe('abc123');
    expect(got?.flywheelRunId).toBe('fw-1');
    expect(got?.costSoFar).toBeCloseTo(1.2345);
    expect(got?.reviewSubRole).toBe('security');
    expect(got?.reviewRunId).toBe('run-7');
  });
});
