import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAddressInUseError,
  retryDashboardBind,
} from '../../../src/dashboard/server/server-bind.js';

describe('dashboard server bind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient EADDRINUSE before succeeding', async () => {
    let attempts = 0;
    const bind = Effect.suspend(() => {
      attempts += 1;
      return attempts < 3
        ? Effect.fail({ cause: Object.assign(new Error('address in use'), { code: 'EADDRINUSE' }) })
        : Effect.succeed('bound');
    });

    const onRetry = vi.fn();
    const result = Effect.runPromise(retryDashboardBind(bind, onRetry));
    await vi.advanceTimersByTimeAsync(500);

    await expect(result).resolves.toBe('bound');
    expect(attempts).toBe(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 250);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 250);
  });

  it('does not retry a non-address bind failure', async () => {
    const failure = { cause: Object.assign(new Error('permission denied'), { code: 'EACCES' }) };
    let attempts = 0;
    const bind = Effect.suspend(() => {
      attempts += 1;
      return Effect.fail(failure);
    });

    await expect(Effect.runPromise(retryDashboardBind(bind))).rejects.toBeDefined();
    expect(attempts).toBe(1);
    expect(isAddressInUseError(failure)).toBe(false);
  });
});
