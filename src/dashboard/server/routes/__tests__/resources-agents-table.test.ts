/**
 * Tests for GET /api/resources using the SQLite agents table (PAN-1908).
 *
 * Verifies that the resources endpoint reads agent states from the agents table
 * (not the filesystem) and computes hasLiveTmuxSession from tmux sessions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockListAgentStates = vi.hoisted(() => vi.fn());
const mockListSessionsSync = vi.hoisted(() => vi.fn());
const mockGetStats = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/agents.js', () => ({
  listAgentStates: mockListAgentStates,
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionsSync: mockListSessionsSync,
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

async function runResourcesEffect(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await Effect.runPromise(getResourcesEffect());
  const raw = response.body as { body: Uint8Array } | null;
  const text = raw?.body ? new TextDecoder().decode(raw.body) : '{}';
  return { status: response.status, body: JSON.parse(text) };
}

describe('GET /api/resources (agents table)', () => {
  beforeEach(() => {
    mockListAgentStates.mockReturnValue([]);
    mockListSessionsSync.mockReturnValue([]);
    mockGetStats.mockReturnValue([]);
  });

  it('returns agents from the SQLite agents table, not the filesystem', async () => {
    mockListAgentStates.mockReturnValue([
      {
        id: 'agent-pan-1908',
        issueId: 'PAN-1908',
        status: 'running',
        model: 'claude-opus-4-8',
        role: 'work',
      },
      {
        id: 'agent-pan-1908-review',
        issueId: 'PAN-1908',
        status: 'stopped',
        model: 'claude-sonnet-4-8',
        role: 'review',
      },
    ]);
    mockListSessionsSync.mockReturnValue([{ name: 'agent-pan-1908' }]);

    const { status, body } = await runResourcesEffect();

    expect(status).toBe(200);
    expect(body.containers).toEqual([]);
    expect(body.agents).toHaveLength(1);
    expect((body.agents as Record<string, unknown>[])[0]).toMatchObject({
      id: 'agent-pan-1908',
      status: 'running',
      hasLiveTmuxSession: true,
    });
  });

  it('filters out stopped agents', async () => {
    mockListAgentStates.mockReturnValue([
      { id: 'agent-1', status: 'running' },
      { id: 'agent-2', status: 'stopped' },
      { id: 'agent-3', status: 'error' },
    ]);
    mockListSessionsSync.mockReturnValue([]);

    const { body } = await runResourcesEffect();
    const ids = (body.agents as Record<string, unknown>[]).map((a) => a.id);

    expect(ids).toContain('agent-1');
    expect(ids).toContain('agent-3');
    expect(ids).not.toContain('agent-2');
  });

  it('sets hasLiveTmuxSession false when the tmux session is missing', async () => {
    mockListAgentStates.mockReturnValue([
      { id: 'agent-orphan', status: 'running' },
    ]);
    mockListSessionsSync.mockReturnValue([]);

    const { body } = await runResourcesEffect();

    expect((body.agents as Record<string, unknown>[])[0]).toMatchObject({
      id: 'agent-orphan',
      hasLiveTmuxSession: false,
    });
  });

  it('returns docker container stats from the collector', async () => {
    mockGetStats.mockReturnValue([
      { name: 'container-1', cpu: '10%', mem: '100MiB', status: 'running' },
    ]);

    getDockerStatsCollector();

    const { body } = await runResourcesEffect();

    expect(body.containers).toEqual([
      { name: 'container-1', cpu: '10%', mem: '100MiB', status: 'running' },
    ]);
  });
});
