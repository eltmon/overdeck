import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshingSnapshot } from '../refreshing-snapshot.js';

const options = { ttlMs: 15_000, maxAgeMs: 300_000, retryMs: 5_000 };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('shared polling snapshots', () => {
  it('shares cold requests and serves last-good data during exactly one refresh', async () => {
    let complete!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { complete = resolve; }));
    const cache = createRefreshingSnapshot(load, options);
    const first = cache.get();
    const second = cache.get();
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledOnce();
    complete('first');
    await expect(first).resolves.toBe('first');
    await vi.advanceTimersByTimeAsync(14_999);
    await expect(cache.get()).resolves.toBe('first');
    expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(cache.get()).resolves.toBe('first');
    await expect(cache.get()).resolves.toBe('first');
    expect(load).toHaveBeenCalledTimes(2);
    complete('second');
    await vi.advanceTimersByTimeAsync(0);
    await expect(cache.get()).resolves.toBe('second');
  });

  it('bounds stale data, backs off errors across clients, and recovers', async () => {
    const load = vi.fn().mockResolvedValueOnce('good').mockRejectedValue(new Error('offline'));
    const cache = createRefreshingSnapshot(load, options);
    await expect(cache.get()).resolves.toBe('good');
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(cache.get()).resolves.toBe('good');
    await vi.advanceTimersByTimeAsync(0);
    await expect(cache.get()).resolves.toBe('good');
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(285_000);
    await expect(cache.get()).rejects.toThrow('offline');
    await expect(cache.get()).rejects.toThrow('offline');
    expect(load).toHaveBeenCalledTimes(3);
    load.mockResolvedValue('recovered');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(cache.get()).resolves.toBe('recovered');
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('backs off cold errors and catches synchronous loader failures', async () => {
    const load = vi.fn(() => { throw new Error('cold failure'); });
    const cache = createRefreshingSnapshot(load, options);
    await expect(cache.get()).rejects.toThrow('cold failure');
    await expect(cache.get()).rejects.toThrow('cold failure');
    expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(cache.get()).rejects.toThrow('cold failure');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
