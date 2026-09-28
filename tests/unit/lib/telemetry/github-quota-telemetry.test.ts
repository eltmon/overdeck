/**
 * PAN-4264 Work Item 23: hourly bucketed github_quota_sample, and
 * github_rate_limited throttled to one per 10 minutes per install.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendLedgerEntry } from '../../../../src/lib/github-quota/ledger.js';
import { recordGitHubRefusal } from '../../../../src/lib/github-quota/pause-gate.js';
import {
  GITHUB_QUOTA_TELEMETRY_INTERVAL_MS,
  captureGitHubRateLimited,
  registerGitHubRateLimitedTelemetry,
  startGitHubQuotaTelemetry,
} from '../../../../src/lib/telemetry/github-quota-telemetry.js';

const MINUTE = 60_000;

describe('GitHub quota telemetry (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 27, 15, 0));
    home = mkdtempSync(join(tmpdir(), 'pan-quota-telemetry-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('captures one bucketed github_quota_sample per hourly tick', async () => {
    const base = { kind: 'call' as const, pool: 'user' as const, estimated: false, outcome: 'ok' as const };
    await appendLedgerEntry({ ...base, caller: 'pipeline-membership', bucket: 'graphql', cost: 620 });
    await appendLedgerEntry({ ...base, caller: 'ci-repair', bucket: 'rest', cost: 12 });
    await appendLedgerEntry({ ...base, caller: 'quota-sampler', kind: 'sample', bucket: 'graphql', cost: 0, remaining: 3000, limit: 5000 });
    const analytics = { capture: vi.fn() };

    const stop = startGitHubQuotaTelemetry(GITHUB_QUOTA_TELEMETRY_INTERVAL_MS, { analytics });
    await vi.advanceTimersByTimeAsync(GITHUB_QUOTA_TELEMETRY_INTERVAL_MS - 1);
    expect(analytics.capture).not.toHaveBeenCalled();
    vi.setSystemTime(Date.UTC(2026, 8, 27, 15, 30));
    await vi.advanceTimersByTimeAsync(1);
    stop();

    expect(analytics.capture).toHaveBeenCalledTimes(1);
    const [event, properties] = analytics.capture.mock.calls[0]!;
    expect(event).toBe('github_quota_sample');
    expect(properties).toMatchObject({
      graphql_pipeline_membership: '500-999',
      rest_ci_repair: '1-49',
      graphql_pr_sync: '0',
      min_remaining_graphql: '2500+',
      min_remaining_rest: 'unknown',
      primary_limit_errors: '0',
    });
    expect(Object.values(properties as Record<string, unknown>).every((value) => typeof value === 'string')).toBe(true);
  });

  it('throttles github_rate_limited to one per 10 minutes', async () => {
    const analytics = { capture: vi.fn() };
    const event = { caller: 'pipeline-membership' as const, kind: 'primary' as const, ownUsageLow: true };

    expect(await captureGitHubRateLimited(event, { analytics })).toBe(true);
    vi.setSystemTime(Date.now() + 5 * MINUTE);
    expect(await captureGitHubRateLimited(event, { analytics })).toBe(false);
    vi.setSystemTime(Date.now() + 6 * MINUTE);
    expect(await captureGitHubRateLimited(event, { analytics })).toBe(true);

    expect(analytics.capture.mock.calls).toEqual([
      ['github_rate_limited', { caller: 'pipeline_membership', kind: 'primary', own_usage_low: true }],
      ['github_rate_limited', { caller: 'pipeline_membership', kind: 'primary', own_usage_low: true }],
    ]);
  });

  it('reports refusals recorded through the pause gate once registered', async () => {
    const analytics = { capture: vi.fn() };
    const unregister = registerGitHubRateLimitedTelemetry({ analytics });
    try {
      await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'secondary' } });
      await vi.waitFor(() => expect(analytics.capture).toHaveBeenCalledTimes(1));
    } finally {
      unregister();
    }
    expect(analytics.capture.mock.calls[0]).toEqual(['github_rate_limited', { caller: 'pr_sync', kind: 'secondary', own_usage_low: true }]);
  });
});
