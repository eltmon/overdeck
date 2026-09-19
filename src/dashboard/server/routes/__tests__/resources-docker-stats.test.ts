/**
 * Tests for GET /api/resources (PAN-1908).
 *
 * PAN-3917 FR-12: the agents table is gone. An agent row IS a live backend
 * pane, and `routes/resources-agents.test.ts` covers that read. What is left
 * here is the docker half of the payload and the ps parser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockListSessions = vi.hoisted(() => vi.fn());
const mockListPaneValues = vi.hoisted(() => vi.fn());
const mockGetStats = vi.hoisted(() => vi.fn());

vi.mock('../../services/dashboard-poll-snapshots.js', () => ({
  getAgentCostStatsSnapshot: async () => [],
}));

vi.mock('../../../../lib/tmux.js', () => ({
  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listPaneValuesSync: () => [],
  listSessions: () => Effect.succeed(mockListSessions()),
  listPaneValues: (...args: unknown[]) => Effect.succeed(mockListPaneValues(...args)),
}));

vi.mock('../../../../lib/runtime-census.js', () => ({
  getRuntimeCensus: async () => ({
    sessionNames: new Set(mockListSessions().map((session: { name: string }) => session.name)),
    processesByPid: new Map(),
  }),
  panePidsForSession: (_census: unknown, sessionName: string) => mockListPaneValues(sessionName),
}));

vi.mock('../../../../lib/docker-stats.js', () => ({
  DockerStatsCollector: class {
    start() {
      return Effect.void;
    }

    getStats() {
      return mockGetStats();
    }
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { getResourcesEffect, getDockerStatsCollector } from '../resources.js';
import { parseProcessTable } from '../resources/agents-stats.js';

describe('parseProcessTable compatibility', () => {
  it('preserves the exported four-column ps parser', () => {
    expect(parseProcessTable('100 1 2.5 2048')).toEqual([
      { pid: 100, ppid: 1, cpuPercent: 2.5, rssBytes: 2048 * 1024 },
    ]);
  });
});

async function runResourcesEffect(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await Effect.runPromise(getResourcesEffect());
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('GET /api/resources (docker stats)', () => {
  beforeEach(() => {
    mockListSessions.mockReturnValue([]);
    mockListPaneValues.mockReturnValue([]);
    mockGetStats.mockReturnValue([]);
  });

  it('returns docker container stats from the collector', async () => {
    mockGetStats.mockReturnValue([
      { name: 'container-1', cpu: '10%', mem: '100MiB', status: 'running' },
    ]);

    getDockerStatsCollector();

    const { body } = await runResourcesEffect();

    expect(body.containers).toEqual([
      {
        name: 'container-1',
        cpu: '10%',
        mem: '100MiB',
        status: 'running',
        memLimitBytes: null,
        oomKills24h: 0,
      },
    ]);
  });
});
