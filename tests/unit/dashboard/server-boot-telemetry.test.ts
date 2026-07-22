import { describe, expect, it, vi } from 'vitest';
import {
  bucketServerCount,
  captureServerBootTelemetry,
  startServerBootTelemetry,
} from '../../../src/dashboard/server/telemetry.js';

describe('server boot telemetry', () => {
  it('buckets project and active-agent counts', async () => {
    const capture = vi.fn();

    await captureServerBootTelemetry({
      analytics: { capture },
      listProjects: () => [{}, {}, {}],
      listAgents: async () => [
        { tmuxActive: true },
        { tmuxActive: true },
        { tmuxActive: false },
        { tmuxActive: true },
        { tmuxActive: true },
        { tmuxActive: false },
      ],
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('server_boot', {
      project_count: '3-5',
      active_agent_count: '3-5',
    });
  });

  it('starts without awaiting agent discovery', async () => {
    let resolveAgents!: (agents: Array<{ tmuxActive: boolean }>) => void;
    const capture = vi.fn();
    const listAgents = vi.fn(() => new Promise<Array<{ tmuxActive: boolean }>>((resolve) => {
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
      listAgents: async () => [{ tmuxActive: true }],
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
