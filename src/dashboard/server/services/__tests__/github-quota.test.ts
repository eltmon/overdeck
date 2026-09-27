/**
 * PAN-4264 Work Item 15: the quota publisher emits github_quota.changed with
 * emitOnly (never the durable log), only when the snapshot changed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const { emitOnly, appendDomainEventAsync } = vi.hoisted(() => ({
  emitOnly: vi.fn(),
  appendDomainEventAsync: vi.fn(),
}));

vi.mock('../../event-store.js', () => ({
  getEventStore: () => ({ emitOnly, appendDomainEventAsync }),
}));

vi.mock('../../../../lib/github-quota/identity.js', () => ({
  getGitHubLogin: vi.fn(async () => 'octo-login'),
}));

import { appendLedgerEntry } from '../../../../lib/github-quota/ledger.js';
import { recordGitHubRefusal } from '../../../../lib/github-quota/pause-gate.js';
import { buildGitHubQuotaSnapshot } from '../../../../lib/github-quota/snapshot.js';
import {
  GITHUB_QUOTA_PUBLISH_INTERVAL_MS,
  refreshGitHubQuotaSnapshot,
  resetGitHubQuotaPublisherForTests,
  startGitHubQuotaPublisher,
} from '../github-quota.js';

const NOW = Date.UTC(2026, 8, 27, 15, 30);

describe('GitHub quota publisher (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    home = mkdtempSync(join(tmpdir(), 'pan-quota-publisher-'));
    process.env.OVERDECK_HOME = home;
    emitOnly.mockClear();
    appendDomainEventAsync.mockClear();
    resetGitHubQuotaPublisherForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('emits once with emitOnly for a ledger with a pause, and not again on an unchanged tick', async () => {
    await recordGitHubRefusal({ pool: 'user', bucket: 'graphql', caller: 'pipeline-membership', refusal: { kind: 'primary' } });

    const stop = startGitHubQuotaPublisher();
    await vi.advanceTimersByTimeAsync(0);
    expect(emitOnly).toHaveBeenCalledTimes(1);
    const [event] = emitOnly.mock.calls[0]!;
    expect(event).toMatchObject({
      type: 'github_quota.changed',
      payload: {
        login: 'octo-login',
        pauses: [expect.objectContaining({ pool: 'user', bucket: 'graphql', kind: 'primary' })],
        refusals: { primary: 1, secondary: 0 },
      },
    });

    await vi.advanceTimersByTimeAsync(GITHUB_QUOTA_PUBLISH_INTERVAL_MS);
    expect(emitOnly).toHaveBeenCalledTimes(1);
    expect(appendDomainEventAsync).not.toHaveBeenCalled();

    // The pause lapsing is a change: it republishes.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(emitOnly).toHaveBeenCalledTimes(2);
    expect(emitOnly.mock.calls[1]![0].payload.pauses).toEqual([]);
    stop();
  });

  it('returns the published snapshot so the REST body equals the read model', async () => {
    const first = await refreshGitHubQuotaSnapshot();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = await refreshGitHubQuotaSnapshot();
    expect(second).toBe(first);
    expect(emitOnly.mock.calls[0]![0].payload).toBe(first);
  });

  it('floors unattributed at 0 and reports what the sample shows beyond metered use', async () => {
    const resetAt = new Date(NOW + 30 * 60_000).toISOString();
    const sample = { kind: 'sample' as const, caller: 'quota-sampler' as const, pool: 'user' as const, bucket: 'graphql' as const, cost: 0, estimated: false, outcome: 'ok' as const, limit: 5000, resetAt };
    const call = { kind: 'call' as const, caller: 'pr-sync' as const, pool: 'user' as const, bucket: 'graphql' as const, estimated: true, outcome: 'ok' as const };

    await appendLedgerEntry({ ...call, ts: new Date(NOW - 20 * 60_000).toISOString(), cost: 300 });
    await appendLedgerEntry({ ...sample, ts: new Date(NOW - 10 * 60_000).toISOString(), remaining: 4900 });
    expect(buildGitHubQuotaSnapshot(NOW, null).unattributed).toBe(0);

    await appendLedgerEntry({ ...sample, ts: new Date(NOW - 5 * 60_000).toISOString(), remaining: 4000 });
    expect(buildGitHubQuotaSnapshot(NOW, null).unattributed).toBe(700);
  });
});
