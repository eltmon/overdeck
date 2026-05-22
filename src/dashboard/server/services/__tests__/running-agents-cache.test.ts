import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRunningAgentsCache, getCachedRunningAgents } from '../running-agents-cache.js';
import type { AgentState } from '../../../../lib/agents.js';

type RunningAgent = AgentState & { tmuxActive: boolean };
type ListAgentsFn = () => Effect.Effect<RunningAgent[], never>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-28T01:15:00Z'));
  clearRunningAgentsCache();
});

afterEach(() => {
  clearRunningAgentsCache();
  vi.useRealTimers();
});

describe('running-agents-cache', () => {
  it('reuses the global cached agents list within the ttl', async () => {
    const firstAgents = [{ id: 'agent-1', issueId: 'PAN-895' }];
    const secondAgents = [{ id: 'agent-2', issueId: 'PAN-999' }];
    const listAgents = vi
      .fn<ListAgentsFn>()
      .mockReturnValueOnce(Effect.succeed(firstAgents as RunningAgent[]))
      .mockReturnValueOnce(Effect.succeed(secondAgents as RunningAgent[]));

    const first = await getCachedRunningAgents(listAgents as unknown as ListAgentsFn);
    const second = await getCachedRunningAgents(listAgents as unknown as ListAgentsFn);

    expect(first).toBe(firstAgents);
    expect(second).toBe(firstAgents);
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after the ttl expires', async () => {
    const firstAgents = [{ id: 'agent-1', issueId: 'PAN-895' }];
    const secondAgents = [{ id: 'agent-2', issueId: 'PAN-895' }];
    const listAgents = vi
      .fn<ListAgentsFn>()
      .mockReturnValueOnce(Effect.succeed(firstAgents as RunningAgent[]))
      .mockReturnValueOnce(Effect.succeed(secondAgents as RunningAgent[]));

    await getCachedRunningAgents(listAgents as unknown as ListAgentsFn);
    await vi.advanceTimersByTimeAsync(3_001);
    const refreshed = await getCachedRunningAgents(listAgents as unknown as ListAgentsFn);

    expect(refreshed).toBe(secondAgents);
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent cache misses into one list call', async () => {
    let resolveAgents: ((value: RunningAgent[]) => void) | undefined;
    const listAgents = vi.fn<ListAgentsFn>(
      () => Effect.promise(() => new Promise<RunningAgent[]>((resolve) => {
        resolveAgents = resolve;
      })),
    );

    const firstPromise = getCachedRunningAgents(listAgents as unknown as ListAgentsFn);
    const secondPromise = getCachedRunningAgents(listAgents as unknown as ListAgentsFn);

    expect(listAgents).toHaveBeenCalledTimes(1);

    resolveAgents?.([{ id: 'agent-1', issueId: 'PAN-895' } as RunningAgent]);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toEqual([{ id: 'agent-1', issueId: 'PAN-895' }]);
    expect(second).toEqual(first);
  });
});
