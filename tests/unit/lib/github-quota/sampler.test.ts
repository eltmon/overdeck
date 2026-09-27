/**
 * PAN-4264 Work Item 14: the rate-limit sampler writes one sample line per
 * bucket and pool, at boot +2 minutes and then every 5 minutes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { flushLedgerWrites, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import { getGitHubLogin, resetGitHubLoginForTests } from '../../../../src/lib/github-quota/identity.js';
import {
  QUOTA_SAMPLER_INITIAL_DELAY_MS,
  QUOTA_SAMPLER_INTERVAL_MS,
  sampleGitHubRateLimits,
  startGitHubQuotaSampler,
} from '../../../../src/lib/github-quota/sampler.js';

const RESET_SEC = Math.floor(Date.UTC(2026, 8, 27, 16, 0) / 1000);
const RATE_LIMIT_FIXTURE = JSON.stringify({
  resources: {
    core: { limit: 5000, used: 10, remaining: 4990, reset: RESET_SEC },
    graphql: { limit: 5000, used: 44, remaining: 4956, reset: RESET_SEC },
    search: { limit: 30, used: 0, remaining: 30, reset: RESET_SEC },
  },
});

describe('GitHub quota sampler (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 27, 15, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-quota-sampler-'));
    process.env.OVERDECK_HOME = home;
    resetGitHubLoginForTests();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushLedgerWrites();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('writes graphql and core samples for the user pool and a free sampler call', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: RATE_LIMIT_FIXTURE });

    await sampleGitHubRateLimits({ exec, isAppConfigured: () => false });
    await flushLedgerWrites();

    expect(exec).toHaveBeenCalledWith(['api', 'rate_limit'], expect.any(Object));
    const entries = readLedgerWindow(Date.now());
    const samples = entries.filter((e) => e.kind === 'sample');
    expect(samples).toEqual([
      expect.objectContaining({ pool: 'user', bucket: 'graphql', remaining: 4956, limit: 5000, resetAt: new Date(RESET_SEC * 1000).toISOString() }),
      expect.objectContaining({ pool: 'user', bucket: 'rest', remaining: 4990, limit: 5000, resetAt: new Date(RESET_SEC * 1000).toISOString() }),
    ]);
    expect(entries.filter((e) => e.kind === 'call')).toEqual([
      expect.objectContaining({ caller: 'quota-sampler', cost: 0, estimated: false }),
    ]);
  });

  it('also samples the app pool when the App is configured', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: RATE_LIMIT_FIXTURE });
    const readAppRateLimit = vi.fn().mockResolvedValue({
      resources: { core: { limit: 15000, remaining: 14000, reset: RESET_SEC }, graphql: { limit: 12500, remaining: 12000, reset: RESET_SEC } },
    });

    await sampleGitHubRateLimits({ exec, isAppConfigured: () => true, readAppRateLimit });

    const appSamples = readLedgerWindow(Date.now()).filter((e) => e.kind === 'sample' && e.pool === 'app');
    expect(appSamples.map((e) => [e.bucket, e.remaining, e.limit])).toEqual([['graphql', 12000, 12500], ['rest', 14000, 15000]]);
  });

  it('first samples at +2 minutes, then every 5 minutes', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: RATE_LIMIT_FIXTURE });
    const stop = startGitHubQuotaSampler(QUOTA_SAMPLER_INTERVAL_MS, { exec, isAppConfigured: () => false });

    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLER_INITIAL_DELAY_MS - 1);
    expect(exec).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exec).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLER_INTERVAL_MS);
    expect(exec).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLER_INTERVAL_MS * 3);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('never throws when gh fails', async () => {
    const exec = vi.fn().mockRejectedValue(Object.assign(new Error('gh: not logged in'), { stderr: 'not logged in' }));
    await expect(sampleGitHubRateLimits({ exec, isAppConfigured: () => false })).resolves.toBeUndefined();
  });

  it('memoizes the login and retries after a failure', async () => {
    const failing = vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { stderr: 'offline' }));
    await expect(getGitHubLogin(failing)).resolves.toBeNull();

    const exec = vi.fn().mockResolvedValue({ stdout: 'octo-login\n' });
    await expect(getGitHubLogin(exec)).resolves.toBe('octo-login');
    await expect(getGitHubLogin(exec)).resolves.toBe('octo-login');
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
