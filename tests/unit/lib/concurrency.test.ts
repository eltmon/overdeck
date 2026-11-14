import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSettledTtlPromiseCache } from '../../../src/lib/concurrency.js';

describe('createSettledTtlPromiseCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps pending work single-flight beyond the settled-value TTL', async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const get = createSettledTtlPromiseCache<string, string>(30_000, Date.now);

    const first = get('repo', load);
    await vi.advanceTimersByTimeAsync(60_000);
    const second = get('repo', load);

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    resolve('done');
    await expect(first).resolves.toBe('done');
  });

  it('keeps an "idle" value cached past its flat TTL and expires it at its own longer TTL (PAN-4291 AC1)', async () => {
    let now = 0;
    const ttlFor = (value: string) => (value === 'idle' ? 300_000 : 30_000);
    const load = vi.fn(async () => 'idle');
    const get = createSettledTtlPromiseCache<string, string>(30_000, () => now, ttlFor);

    await get('repo', load);
    now += 60_000;
    await get('repo', load);
    expect(load).toHaveBeenCalledOnce();

    now += 240_000; // total +300_000ms: at the idle TTL boundary
    await get('repo', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('expires a "busy" value at its own shorter TTL (PAN-4291 AC2)', async () => {
    let now = 0;
    const ttlFor = (value: string) => (value === 'idle' ? 300_000 : 30_000);
    const load = vi.fn(async () => 'busy');
    const get = createSettledTtlPromiseCache<string, string>(30_000, () => now, ttlFor);

    await get('repo', load);
    now += 30_000; // at the busy TTL boundary
    await get('repo', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('without ttlFor, caches for exactly ttlMs and reloads after it (PAN-4291 AC3)', async () => {
    let now = 0;
    const load = vi.fn(async () => 'value');
    const get = createSettledTtlPromiseCache<string, string>(30_000, () => now);

    await get('repo', load);
    now += 29_999;
    await get('repo', load);
    expect(load).toHaveBeenCalledOnce();

    now += 1; // total +30_000ms
    await get('repo', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidate(key, { includeInFlight: true }) during a load makes the next get start a new load (PAN-5224)', async () => {
    let resolveFirst!: (value: string) => void;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((done) => { resolveFirst = done; }))
      .mockImplementationOnce(async () => 'second');
    const get = createSettledTtlPromiseCache<string, string>(30_000, Date.now);

    const first = get('repo', load);
    get.invalidate('repo', { includeInFlight: true });
    const second = get('repo', load);

    expect(second).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
    resolveFirst('first');
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('invalidate(key) without the option keeps the in-flight load single-flight (PAN-5224)', async () => {
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const get = createSettledTtlPromiseCache<string, string>(30_000, Date.now);

    const first = get('repo', load);
    get.invalidate('repo');
    const second = get('repo', load);

    expect(second).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    resolve('done');
    await expect(first).resolves.toBe('done');
  });
});
