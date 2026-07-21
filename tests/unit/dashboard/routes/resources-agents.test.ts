import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
  buildAgentStatsSnapshot,
  getAgentStatsSnapshotEffect,
  type AgentCostEvent,
  type AgentProcessRecord,
  type MinimalAgentState,
} from '../../../../src/dashboard/server/routes/resources.js';

const NOW_MS = Date.parse('2026-07-07T12:00:00.000Z');

describe('agent resource stats payload', () => {
  it('extrapolates recent agent cost events into burn dollars per hour', () => {
    const snapshot = buildAgentStatsSnapshot({
      nowMs: NOW_MS,
      agents: [agent('agent-pan-2464-work')],
      sessionRoots: [],
      processes: [],
      costEventsByAgent: new Map([
        ['agent-pan-2464-work', [
          costEvent('agent-pan-2464-work', 20, 0.55),
          costEvent('agent-pan-2464-work', 5, 0.50),
        ]],
      ]),
    });

    expect(snapshot.agents[0].burnUsdPerHour).toBeGreaterThanOrEqual(2.00);
    expect(snapshot.agents[0].burnUsdPerHour).toBeLessThanOrEqual(2.20);
  });

  it('moves subscription-covered usage into hypothetical burn for tooltip display', () => {
    const snapshot = buildAgentStatsSnapshot({
      nowMs: NOW_MS,
      agents: [agent('agent-pan-2464-subscription')],
      sessionRoots: [],
      processes: [],
      costEventsByAgent: new Map([
        ['agent-pan-2464-subscription', [
          {
            ...costEvent('agent-pan-2464-subscription', 10, 0.75),
            subscriptionCovered: true,
          },
        ]],
      ]),
    });

    expect(snapshot.agents[0]).toMatchObject({
      burnUsdPerHour: 0,
      hypotheticalUsdPerHour: 1.5,
      totalUsd: 0,
    });
  });

  it('sums a four-process pid tree from one batched process parse', async () => {
    const readProcessTable = vi.fn(async (): Promise<AgentProcessRecord[]> => [
      process(100, 1, 1, 10_000),
      process(110, 100, 2.5, 20_000),
      process(120, 110, 3.25, 30_000),
      process(130, 100, 4.75, 40_000),
      process(999, 1, 99, 900_000),
    ]);

    const snapshot = await Effect.runPromise(getAgentStatsSnapshotEffect({
      nowMs: NOW_MS,
      listAgents: () => [agent('agent-pan-2464-tree')],
      listSessionNames: () => Effect.succeed(['agent-pan-2464-tree']),
      listPanePids: () => Effect.succeed([100]),
      readProcessTable,
      queryCostEvents: () => [],
    }));

    expect(readProcessTable).toHaveBeenCalledTimes(1);
    expect(snapshot.agents[0]).toMatchObject({
      id: 'agent-pan-2464-tree',
      rootPid: 100,
      processCount: 4,
      cpuPercent: 11.5,
      memoryBytes: 100_000,
    });
  });

  it('feeds hostVitals.agents.burnUsdPerHour from summed per-session burn rates', () => {
    const snapshot = buildAgentStatsSnapshot({
      nowMs: NOW_MS,
      agents: [
        agent('agent-pan-2464-a'),
        agent('agent-pan-2464-b'),
      ],
      sessionRoots: [],
      processes: [],
      costEventsByAgent: new Map([
        ['agent-pan-2464-a', [costEvent('agent-pan-2464-a', 10, 0.50)]],
        ['agent-pan-2464-b', [costEvent('agent-pan-2464-b', 10, 0.25)]],
      ]),
    });

    expect(snapshot.hostVitals.agents.burnUsdPerHour).toBe(1.5);
  });
});

function agent(id: string): MinimalAgentState {
  return {
    id,
    issueId: 'PAN-2464',
    role: 'work',
    model: 'codex-test',
    status: 'running',
    startedAt: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
    lastActivity: new Date(NOW_MS - 60 * 1000).toISOString(),
  };
}

function costEvent(agentId: string, minutesAgo: number, cost: number): AgentCostEvent {
  return {
    ts: new Date(NOW_MS - minutesAgo * 60 * 1000).toISOString(),
    type: 'cost',
    agentId,
    issueId: 'PAN-2464',
    sessionType: 'work',
    provider: 'test',
    model: 'codex-test',
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost,
  };
}

function process(
  pid: number,
  ppid: number,
  cpuPercent: number,
  rssBytes: number,
): AgentProcessRecord {
  return { pid, ppid, cpuPercent, rssBytes };
}
