import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isTransientForgeError, retryTransientForgeOp } from '../../../src/lib/forge-transient.js';

describe('isTransientForgeError (PAN-4263)', () => {
  it.each([
    'GraphQL: API rate limit already exceeded for user ID 1',
    'You have exceeded a secondary rate limit',
    'abuse detection mechanism triggered',
    'read ECONNRESET',
    'connect ETIMEDOUT 140.82.112.6:443',
    'getaddrinfo ENOTFOUND api.github.com',
    'getaddrinfo EAI_AGAIN api.github.com',
    'connect ECONNREFUSED 127.0.0.1:443',
    'socket hang up',
    'gh pr view feature/x timed out after 30000ms',
    'GitHub API GET /x failed: 503 upstream',
    'HTTP 502: Bad Gateway',
    'HTTP 504: Gateway Timeout',
  ])('treats %j as transient', (message) => {
    expect(isTransientForgeError(new Error(message))).toBe(true);
    expect(isTransientForgeError(message)).toBe(true);
  });

  it.each([
    'no pull requests found for branch "feature/x"',
    'HTTP 404: Not Found',
    'glab mr list failed: 401 Unauthorized',
    'unrecognized artifact URL https://github.com/o/r/pull/504',
  ])('treats %j as not transient', (message) => {
    expect(isTransientForgeError(new Error(message))).toBe(false);
  });

  it('reads stderr on exec-shaped errors', () => {
    expect(isTransientForgeError({ message: 'Command failed', stderr: 'API rate limit exceeded' })).toBe(true);
    expect(isTransientForgeError(undefined)).toBe(false);
  });
});

describe('retryTransientForgeOp (PAN-4263)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('retries a transient failure and resolves once the op succeeds', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('API rate limit exceeded'))
      .mockResolvedValueOnce('ok');

    const result = retryTransientForgeOp(op);
    await vi.advanceTimersByTimeAsync(1999);
    expect(op).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('rejects with the last error after three transient failures and 10 s of backoff', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('rate limit 1'))
      .mockRejectedValueOnce(new Error('rate limit 2'))
      .mockRejectedValueOnce(new Error('rate limit 3'));

    const result = retryTransientForgeOp(op);
    const settled = result.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(2000);
    expect(op).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7999);
    expect(op).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect(await settled).toEqual(new Error('rate limit 3'));
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-transient failure without retrying', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

    await expect(retryTransientForgeOp(op)).rejects.toThrow('HTTP 404');
    expect(op).toHaveBeenCalledTimes(1);
  });
});
