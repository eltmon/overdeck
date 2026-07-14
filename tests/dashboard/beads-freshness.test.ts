import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTasksSyncService, getTasksSyncHealth } from '../../src/dashboard/server/services/tasks-sync-service.js';

describe('tasks dashboard freshness', () => {
  afterEach(() => vi.useRealTimers());

  it('emits only when the Dolt head advances across polls', async () => {
    const emit = vi.fn();
    const heads = ['a'.repeat(40), 'b'.repeat(40)];
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.join(' ') === 'vc status') return `Commit: ${heads.shift() ?? 'b'.repeat(40)}\n`;
      return '';
    });
    const remoteDoltHead = vi.fn().mockResolvedValueOnce('remote-a').mockResolvedValueOnce('remote-b');
    const localDoltHead = vi.fn().mockResolvedValueOnce('a'.repeat(40)).mockResolvedValueOnce('b'.repeat(40));
    const withLock = vi.fn(async (_caller, fn) => fn());
    const service = createTasksSyncService({
      projects: () => [{ key: 'remote-advance', path: '/repo', tasksCwd: '/state' }],
      execute,
      emit,
      withLock,
      remoteDoltHead,
      localDoltHead,
      now: () => Date.parse('2026-07-12T12:00:00Z'),
    });

    // First poll establishes the baseline; no event because there is no previous head.
    await service.syncOnce();
    expect(emit).not.toHaveBeenCalled();
    expect(getTasksSyncHealth('remote-advance')).toMatchObject({ lastError: null, localHead: 'a'.repeat(40) });

    // Second poll sees a remote change that pulls in a new head; event fires.
    await service.syncOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tasks.freshness_changed',
      payload: expect.objectContaining({ projectKey: 'remote-advance', localHead: 'b'.repeat(40) }),
    }));
    expect(getTasksSyncHealth('remote-advance')).toMatchObject({ lastError: null, localHead: 'b'.repeat(40) });
  });

  it('emits when the head advanced locally before the poll', async () => {
    const emit = vi.fn();
    const heads = ['a'.repeat(40), 'b'.repeat(40)];
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.join(' ') === 'vc status') return `Commit: ${heads.shift() ?? 'b'.repeat(40)}\n`;
      return '';
    });
    const remoteDoltHead = vi.fn().mockResolvedValue('remote-a');
    const localDoltHead = vi.fn()
      .mockResolvedValueOnce('a'.repeat(40))
      .mockResolvedValueOnce('b'.repeat(40));
    const withLock = vi.fn(async (_caller, fn) => fn());
    const service = createTasksSyncService({
      projects: () => [{ key: 'local-advance', path: '/repo', tasksCwd: '/state' }],
      execute,
      emit,
      withLock,
      remoteDoltHead,
      localDoltHead,
      now: () => Date.parse('2026-07-12T12:00:00Z'),
    });

    await service.syncOnce();
    expect(emit).not.toHaveBeenCalled();

    await service.syncOnce();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tasks.freshness_changed',
      payload: expect.objectContaining({ projectKey: 'local-advance', localHead: 'b'.repeat(40) }),
    }));
  });

  it('does not emit when the head is unchanged since the previous poll', async () => {
    const emit = vi.fn();
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.join(' ') === 'vc status') return `Commit: ${'a'.repeat(40)}\n`;
      return '';
    });
    const remoteDoltHead = vi.fn().mockResolvedValue(null);
    const localDoltHead = vi.fn().mockResolvedValue('a'.repeat(40));
    const withLock = vi.fn(async (_caller, fn) => fn());
    const service = createTasksSyncService({
      projects: () => [{ key: 'no-movement', path: '/repo', tasksCwd: '/state' }],
      execute,
      emit,
      withLock,
      remoteDoltHead,
      localDoltHead,
      now: () => Date.parse('2026-07-12T12:00:00Z'),
    });

    await service.syncOnce();
    await service.syncOnce();
    expect(emit).not.toHaveBeenCalled();
  });

  it('uses fake-timer backoff and exposes a complete stale consequence on failure', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const service = createTasksSyncService({
      projects: () => [{ key: 'broken', path: '/repo', tasksCwd: '/state' }],
      execute: async () => { throw new Error('remote unavailable'); },
      withLock: async (_caller, fn) => fn(),
      intervalMs: 100,
      random: () => 0,
      sleep: async (ms) => { delays.push(ms); service.stop(); },
    });
    await service.run();
    expect(delays).toEqual([200]);
    expect(getTasksSyncHealth('broken').lastError).toMatch(/dashboard task progress may be stale/);
  });
});
