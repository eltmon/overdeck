import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRunningAgentsCache, getCachedRunningAgents } from '../running-agents-cache.js';

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
      .fn<() => Promise<Array<{ id: string; issueId: string }>>>()
      .mockResolvedValueOnce(firstAgents)
      .mockResolvedValueOnce(secondAgents);

    const first = await getCachedRunningAgents(listAgents);
    const second = await getCachedRunningAgents(listAgents);

    expect(first).toBe(firstAgents);
    expect(second).toBe(firstAgents);
    expect(listAgents).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after the ttl expires', async () => {
    const firstAgents = [{ id: 'agent-1', issueId: 'PAN-895' }];
    const secondAgents = [{ id: 'agent-2', issueId: 'PAN-895' }];
    const listAgents = vi
      .fn<() => Promise<Array<{ id: string; issueId: string }>>>()
      .mockResolvedValueOnce(firstAgents)
      .mockResolvedValueOnce(secondAgents);

    await getCachedRunningAgents(listAgents);
    await vi.advanceTimersByTimeAsync(3_001);
    const refreshed = await getCachedRunningAgents(listAgents);

    expect(refreshed).toBe(secondAgents);
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent cache misses into one list call', async () => {
    let resolveAgents: ((value: Array<{ id: string; issueId: string }>) => void) | undefined;
    const listAgents = vi.fn(
      () => new Promise<Array<{ id: string; issueId: string }>>((resolve) => {
        resolveAgents = resolve;
      }),
    );

    const firstPromise = getCachedRunningAgents(listAgents);
    const secondPromise = getCachedRunningAgents(listAgents);

    expect(listAgents).toHaveBeenCalledTimes(1);

    resolveAgents?.([{ id: 'agent-1', issueId: 'PAN-895' }]);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toEqual([{ id: 'agent-1', issueId: 'PAN-895' }]);
    expect(second).toEqual(first);
  });
});
