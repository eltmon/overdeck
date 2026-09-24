import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRunningAgents: vi.fn((): unknown[] => []),
  listLiveAgentIds: vi.fn(async (): Promise<ReadonlySet<string> | null> => new Set<string>()),
}));

vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgents: () => Effect.sync(() => mocks.listRunningAgents()),
}));

// Fake terminal backend: the live inventory the boot count reads (#4109).
vi.mock('../../../src/lib/terminal-backends/inventory.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/lib/terminal-backends/inventory.js')>(),
  listLiveAgentIds: mocks.listLiveAgentIds,
}));

import {
  bucketServerCount,
  captureServerBootTelemetry,
  listBootTelemetryAgents,
  startServerBootTelemetry,
} from '../../../src/dashboard/server/telemetry.js';

describe('server boot telemetry', () => {
  it('buckets project and active-agent counts', async () => {
    const capture = vi.fn();

    await captureServerBootTelemetry({
      analytics: { capture },
      listProjects: () => [{}, {}, {}],
      listAgents: async () => [
        { hasLivePane: true },
        { hasLivePane: true },
        { hasLivePane: false },
        { hasLivePane: true },
        { hasLivePane: true },
        { hasLivePane: false },
      ],
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('server_boot', {
      project_count: '3-5',
      active_agent_count: '3-5',
    });
  });

  it('starts without awaiting agent discovery', async () => {
    let resolveAgents!: (agents: Array<{ hasLivePane: boolean }>) => void;
    const capture = vi.fn();
    const listAgents = vi.fn(() => new Promise<Array<{ hasLivePane: boolean }>>((resolve) => {
      resolveAgents = resolve;
    }));

    expect(startServerBootTelemetry({
      analytics: { capture },
      listProjects: () => [],
      listAgents,
    })).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();

    resolveAgents([]);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
  });

  it('does not fail boot when capture throws', async () => {
    await expect(captureServerBootTelemetry({
      analytics: {
        capture: vi.fn(() => { throw new Error('network failure'); }),
      },
      listProjects: () => [{}],
      listAgents: async () => [{ hasLivePane: true }],
    })).resolves.toBeUndefined();
  });

  it('uses the canonical count buckets', () => {
    expect(bucketServerCount(0)).toBe('0');
    expect(bucketServerCount(2)).toBe('1-2');
    expect(bucketServerCount(5)).toBe('3-5');
    expect(bucketServerCount(10)).toBe('6-10');
    expect(bucketServerCount(11)).toBe('11+');
  });
});

describe('listBootTelemetryAgents (#4109)', () => {
  it('counts a live Herdr agent (tmuxActive false) the backend inventory lists', async () => {
    mocks.listRunningAgents.mockReturnValue([
      { id: 'agent-herdr', status: 'running', tmuxActive: false },
      { id: 'agent-gone', status: 'running', tmuxActive: false },
    ]);
    mocks.listLiveAgentIds.mockResolvedValue(new Set(['agent-herdr']));

    expect(await listBootTelemetryAgents()).toEqual([{ hasLivePane: true }, { hasLivePane: false }]);
  });

  it('counts the running rows when the inventory is unreadable', async () => {
    mocks.listRunningAgents.mockReturnValue([
      { id: 'agent-a', status: 'running', tmuxActive: false },
      { id: 'agent-b', status: 'stopped', tmuxActive: false },
    ]);
    mocks.listLiveAgentIds.mockResolvedValue(null);

    expect(await listBootTelemetryAgents()).toEqual([{ hasLivePane: true }, { hasLivePane: false }]);
  });
});
