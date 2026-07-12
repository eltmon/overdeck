import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBeadsSyncService, getBeadsSyncHealth } from '../../src/dashboard/server/services/beads-sync-service.js';

describe('beads dashboard freshness', () => {
  afterEach(() => vi.useRealTimers());

  it('pulls off the request path and emits only when the Dolt head advances', async () => {
    const emit = vi.fn();
    const heads = ['a'.repeat(40), 'b'.repeat(40)];
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args.join(' ') === 'vc status') return `Commit: ${heads.shift() ?? 'b'.repeat(40)}\n`;
      return '';
    });
    const withLock = vi.fn(async (_caller, fn) => fn());
    const service = createBeadsSyncService({
      projects: () => [{ key: 'fixture', path: '/repo', beadsCwd: '/state' }],
      execute,
      emit,
      withLock,
      now: () => Date.parse('2026-07-12T12:00:00Z'),
    });
    await service.syncOnce();
    expect(execute.mock.calls.map(([args]) => args.join(' '))).toEqual(['vc status', 'dolt pull', 'vc status']);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'beads.freshness_changed' }));
    expect(getBeadsSyncHealth('fixture')).toMatchObject({ lastError: null, localHead: 'b'.repeat(40) });
  });

  it('uses fake-timer backoff and exposes a complete stale consequence on failure', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const service = createBeadsSyncService({
      projects: () => [{ key: 'broken', path: '/repo', beadsCwd: '/state' }],
      execute: async () => { throw new Error('remote unavailable'); },
      withLock: async (_caller, fn) => fn(),
      intervalMs: 100,
      random: () => 0,
      sleep: async (ms) => { delays.push(ms); service.stop(); },
    });
    await service.run();
    expect(delays).toEqual([200]);
    expect(getBeadsSyncHealth('broken').lastError).toMatch(/dashboard bead progress may be stale/);
  });
});
