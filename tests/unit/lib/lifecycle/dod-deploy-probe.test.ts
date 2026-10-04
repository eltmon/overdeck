import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readHealthWithRetry } from '../../../../src/lib/lifecycle/dod-deploy-probe.js';

const url = 'http://127.0.0.1:3011/api/health';

describe('readHealthWithRetry (PAN-4543)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns the health body once a later attempt answers within the stall', async () => {
    const readJson = vi.fn()
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      .mockResolvedValue({ ok: true });

    const pending = readHealthWithRetry(readJson, url);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(readJson).toHaveBeenCalledTimes(3);
    expect(readJson).toHaveBeenCalledWith(url);
  });

  it('rejects with the attempt count after every attempt fails, and stops at three', async () => {
    const readJson = vi.fn().mockRejectedValue(new Error('connection refused'));

    const pending = readHealthWithRetry(readJson, url);
    const settled = expect(pending).rejects.toThrow('after 3 attempts: connection refused');
    await vi.advanceTimersByTimeAsync(4000);
    await settled;
    expect(readJson).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(readJson).toHaveBeenCalledTimes(3);
  });
});
