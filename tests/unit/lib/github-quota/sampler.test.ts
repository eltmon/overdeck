/**
 * PAN-4264 Work Item 14: the rate-limit sampler writes one sample line per
 * bucket and pool, at boot +2 minutes and then every 5 minutes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { flushLedgerWrites, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import { recordGitHubRefusal } from '../../../../src/lib/github-quota/pause-gate.js';
import { LOGIN_RETRY_MS, getGitHubLogin, resetGitHubLoginForTests } from '../../../../src/lib/github-quota/identity.js';
import {
  QUOTA_SAMPLER_INITIAL_DELAY_MS,
  QUOTA_SAMPLER_INTERVAL_MS,
  sampleGitHubRateLimits,
  startGitHubQuotaSampler,
} from '../../../../src/lib/github-quota/sampler.js';

const RESET_SEC = Math.floor(Date.UTC(2026, 8, 27, 16, 0) / 1000);
const RESET_ISO = new Date(RESET_SEC * 1000).toISOString();
const RATE_LIMIT_FIXTURE = JSON.stringify({
  resources: {
    core: { limit: 5000, used: 10, remaining: 4990, reset: RESET_SEC },
    graphql: { limit: 5000, used: 44, remaining: 4956, reset: RESET_SEC },
    search: { limit: 30, used: 0, remaining: 30, reset: RESET_SEC },
  },
});
const GRAPHQL_RATE_LIMIT_FIXTURE = JSON.stringify({
  data: { rateLimit: { limit: 5000, remaining: 2576, resetAt: RESET_ISO } },
});

/** Answers `gh api rate_limit` and `gh api graphql -f query=…rateLimit…` with their own fixtures. */
function dualExec() {
  return vi.fn(async (args: string[]) => ({
    stdout: args[1] === 'graphql' ? GRAPHQL_RATE_LIMIT_FIXTURE : RATE_LIMIT_FIXTURE,
  }));
}

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

  it('writes a user graphql sample from GraphQL rateLimit and a rest sample from REST', async () => {
    const exec = dualExec();

    await sampleGitHubRateLimits({ exec, isAppConfigured: () => false });
    await flushLedgerWrites();

    expect(exec).toHaveBeenCalledWith(['api', 'rate_limit'], expect.any(Object));
    expect(exec).toHaveBeenCalledWith(['api', 'graphql', '-f', expect.stringContaining('rateLimit')], expect.any(Object));
    const entries = readLedgerWindow(Date.now());
    const samples = entries.filter((e) => e.kind === 'sample');
    // The REST and GraphQL samples come from two concurrently-run sources, so
    // their ledger-write order is not guaranteed: assert membership, not order.
    expect(samples).toHaveLength(2);
    expect(samples).toContainEqual(expect.objectContaining({ pool: 'user', bucket: 'rest', remaining: 4990, limit: 5000, resetAt: RESET_ISO }));
    expect(samples).toContainEqual(expect.objectContaining({ pool: 'user', bucket: 'graphql', remaining: 2576, limit: 5000, resetAt: RESET_ISO }));
    const calls = entries.filter((e) => e.kind === 'call');
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual(expect.objectContaining({ caller: 'quota-sampler', bucket: 'rest', cost: 0, estimated: false }));
    expect(calls).toContainEqual(expect.objectContaining({ caller: 'quota-sampler', bucket: 'graphql', cost: 0, estimated: false }));
  });

  it('writes no user graphql sample and keeps the rest sample when the GraphQL rateLimit call rejects', async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[1] === 'graphql') throw Object.assign(new Error('gh: connection reset'), { stderr: 'connection reset' });
      return { stdout: RATE_LIMIT_FIXTURE };
    });

    await expect(sampleGitHubRateLimits({ exec, isAppConfigured: () => false })).resolves.toBeUndefined();
    await flushLedgerWrites();

    const samples = readLedgerWindow(Date.now()).filter((e) => e.kind === 'sample' && e.pool === 'user');
    expect(samples).toEqual([
      expect.objectContaining({ pool: 'user', bucket: 'rest', remaining: 4990, limit: 5000 }),
    ]);
  });

  it('also samples the app pool when the App is configured', async () => {
    const exec = dualExec();
    const readAppRateLimit = vi.fn().mockResolvedValue({
      resources: { core: { limit: 15000, remaining: 14000, reset: RESET_SEC }, graphql: { limit: 12500, remaining: 12000, reset: RESET_SEC } },
    });

    await sampleGitHubRateLimits({ exec, isAppConfigured: () => true, readAppRateLimit });

    const appSamples = readLedgerWindow(Date.now()).filter((e) => e.kind === 'sample' && e.pool === 'app');
    expect(appSamples.map((e) => [e.bucket, e.remaining, e.limit])).toEqual([['graphql', 12000, 12500], ['rest', 14000, 15000]]);
  });

  it('first samples at +2 minutes, then every 5 minutes', async () => {
    const exec = dualExec();
    const stop = startGitHubQuotaSampler(QUOTA_SAMPLER_INTERVAL_MS, { exec, isAppConfigured: () => false });

    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLER_INITIAL_DELAY_MS - 1);
    expect(exec).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exec).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLER_INTERVAL_MS);
    expect(exec).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(QUOTA_SAMPLER_INTERVAL_MS * 3);
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it('still samples during a pause (quota-sampler is essential)', async () => {
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' } });
    await recordGitHubRefusal({ pool: 'user', bucket: 'rest', caller: 'ci-repair', refusal: { kind: 'primary' } });
    const exec = dualExec();
    await sampleGitHubRateLimits({ exec, isAppConfigured: () => false });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('never throws when gh fails', async () => {
    const exec = vi.fn().mockRejectedValue(Object.assign(new Error('gh: not logged in'), { stderr: 'not logged in' }));
    await expect(sampleGitHubRateLimits({ exec, isAppConfigured: () => false })).resolves.toBeUndefined();
  });

  it('memoizes the login, and retries a failure only after 10 minutes', async () => {
    const failing = vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { stderr: 'offline' }));
    await expect(getGitHubLogin(failing)).resolves.toBeNull();
    await expect(getGitHubLogin(failing)).resolves.toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);

    const exec = vi.fn().mockResolvedValue({ stdout: 'octo-login\n' });
    await vi.advanceTimersByTimeAsync(LOGIN_RETRY_MS - 1_000);
    await expect(getGitHubLogin(exec)).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(getGitHubLogin(exec)).resolves.toBe('octo-login');
    await expect(getGitHubLogin(exec)).resolves.toBe('octo-login');
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
