import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { persistCostEventFromDomainEvent } from '../cost-event-projection.js';

let TEST_HOME: string;
const originalHome = process.env.HOME;
const originalPanopticonHome = process.env.PANOPTICON_HOME;

async function resetDb() {
  const { resetDatabase } = await import('../../../../lib/database/index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-cost-projection-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.HOME = TEST_HOME;
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  process.env.HOME = originalHome;
  process.env.PANOPTICON_HOME = originalPanopticonHome;
  if (TEST_HOME && existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

async function seedAgent(agentId: string, issueId: string) {
  const { getDatabase } = await import('../../../../lib/database/index.js');
  const { upsertAgent } = await import('../../../../lib/database/agents-db.js');
  const db = getDatabase();
  db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId);
  upsertAgent({
    id: agentId,
    issueId,
    role: 'work',
    status: 'running',
    workspace: '/tmp/test-workspace',
    harness: 'pi',
    model: 'kimi-k2.7-code',
    branch: 'feature/pan-1935',
    sessionId: null,
    startedAt: new Date().toISOString(),
    lastActivity: null,
    lastResumeAt: null,
    stoppedAt: null,
    stoppedByUser: null,
    stoppedByPause: null,
    kickoffDelivered: null,
    hostOverride: null,
    costSoFar: 0,
    phase: null,
    workType: null,
    paused: null,
    pausedReason: null,
    pausedAt: null,
    troubled: null,
    troubledAt: null,
    consecutiveFailures: null,
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
    supervisorEnabled: null,
    channelsEnabled: null,
    updatedAt: new Date().toISOString(),
  });
}

describe('persistCostEventFromDomainEvent', () => {
  it('writes a pi/kimi cost event to the canonical cost log and SQLite', async () => {
    await seedAgent('agent-pan-1935', 'PAN-1935');

    persistCostEventFromDomainEvent({
      type: 'cost.event_recorded',
      timestamp: '2026-06-16T12:00:00.000Z',
      payload: {
        agentId: 'agent-pan-1935',
        issueId: 'PAN-1935',
        cost: 0.0042,
        inputTokens: 1000,
        outputTokens: 250,
        cacheReadTokens: 50,
        cacheWriteTokens: 25,
        model: 'kimi-k2.7-code',
        sessionType: 'work',
      },
    });

    const eventsFile = join(TEST_HOME, '.panopticon', 'costs', 'events.jsonl');
    expect(existsSync(eventsFile)).toBe(true);
    const lines = readFileSync(eventsFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const written = JSON.parse(lines[0]!);
    expect(written).toMatchObject({
      type: 'cost',
      agentId: 'agent-pan-1935',
      issueId: 'PAN-1935',
      cost: 0.0042,
      input: 1000,
      output: 250,
      cacheRead: 50,
      cacheWrite: 25,
      provider: 'custom',
      model: 'kimi-k2.7-code',
      sessionType: 'work',
    });

    const { queryCostEvents } = await import('../../../../lib/database/cost-events-db.js');
    const rows = queryCostEvents({ agentId: 'agent-pan-1935' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: 'agent-pan-1935',
      issueId: 'PAN-1935',
      cost: 0.0042,
      model: 'kimi-k2.7-code',
      provider: 'custom',
    });
  });

  it('increments agents.cost_so_far for the agent', async () => {
    await seedAgent('agent-pan-1935', 'PAN-1935');

    persistCostEventFromDomainEvent({
      type: 'cost.event_recorded',
      timestamp: '2026-06-16T12:00:00.000Z',
      payload: {
        agentId: 'agent-pan-1935',
        issueId: 'PAN-1935',
        cost: 0.005,
        inputTokens: 100,
        outputTokens: 50,
        model: 'kimi-k2.7-code',
        sessionType: 'work',
      },
    });

    persistCostEventFromDomainEvent({
      type: 'cost.event_recorded',
      timestamp: '2026-06-16T12:00:01.000Z',
      payload: {
        agentId: 'agent-pan-1935',
        issueId: 'PAN-1935',
        cost: 0.007,
        inputTokens: 200,
        outputTokens: 75,
        model: 'kimi-k2.7-code',
        sessionType: 'work',
      },
    });

    const { getAgent } = await import('../../../../lib/database/agents-db.js');
    const agent = getAgent('agent-pan-1935');
    expect(agent).not.toBeNull();
    expect(agent!.costSoFar).toBeCloseTo(0.012, 6);
  });

  it('is a no-op for non-cost events', async () => {
    await seedAgent('agent-pan-1935', 'PAN-1935');

    persistCostEventFromDomainEvent({
      type: 'agent.activity_changed',
      timestamp: '2026-06-16T12:00:00.000Z',
      payload: { agentId: 'agent-pan-1935', activity: 'idle' },
    });

    const eventsFile = join(TEST_HOME, '.panopticon', 'costs', 'events.jsonl');
    expect(existsSync(eventsFile)).toBe(false);

    const { getAgent } = await import('../../../../lib/database/agents-db.js');
    const agent = getAgent('agent-pan-1935');
    expect(agent!.costSoFar).toBe(0);
  });
});
