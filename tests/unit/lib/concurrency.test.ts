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
});
