/**
 * PAN-4264 Work Item 2: the cross-process pause gate — FR-5 pause durations,
 * FR-6 per-(pool, bucket) enforcement, and refusal listeners.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { appendLedgerEntry, getGitHubQuotaDir, readLedgerWindow } from '../../../../src/lib/github-quota/ledger.js';
import {
  assertGitHubCallAllowed,
  GitHubQuotaPausedError,
  onGitHubRefusal,
  readActivePause,
  recordGitHubRefusal,
} from '../../../../src/lib/github-quota/pause-gate.js';

const NOW = Date.UTC(2026, 8, 27, 15, 0);
const MINUTE = 60_000;

function untilMs(pause: { until: string }): number {
  return Date.parse(pause.until);
}

async function writeUserGraphqlSample(remaining: number, resetAtMs: number, ageMs = MINUTE): Promise<void> {
  await appendLedgerEntry({
    ts: new Date(Date.now() - ageMs).toISOString(),
    kind: 'sample',
    caller: 'quota-sampler',
    pool: 'user',
    bucket: 'graphql',
    cost: 0,
    estimated: false,
    outcome: 'ok',
    remaining,
    limit: 5000,
    resetAt: new Date(resetAtMs).toISOString(),
  });
}

describe('GitHub pause gate (PAN-4264)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    home = mkdtempSync(join(tmpdir(), 'pan-github-pause-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('pauses a visible primary limit until the exhausted sample resets', async () => {
    const resetAt = NOW + 25 * MINUTE;
    await writeUserGraphqlSample(0, resetAt);

    const pause = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pipeline-membership', refusal: { kind: 'primary' },
    });

    expect(untilMs(pause)).toBe(resetAt);
    const onDisk = JSON.parse(readFileSync(join(getGitHubQuotaDir(), 'pause.json'), 'utf8'));
    expect(onDisk.pauses['user:graphql']).toMatchObject({ pool: 'user', bucket: 'graphql', kind: 'primary' });
  });

  it('pauses a hidden primary limit for 10 minutes, capped at a sooner sample reset', async () => {
    await writeUserGraphqlSample(4956, NOW + 40 * MINUTE);
    const hidden = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pipeline-membership', refusal: { kind: 'primary' },
    });
    expect(untilMs(hidden)).toBe(NOW + 10 * MINUTE);

    await vi.advanceTimersByTimeAsync(11 * MINUTE);
    const soonReset = Date.now() + 3 * MINUTE;
    await writeUserGraphqlSample(4900, soonReset);
    const capped = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pipeline-membership', refusal: { kind: 'primary' },
    });
    expect(untilMs(capped)).toBe(soonReset);
  });

  it('pauses a hidden primary limit for 10 minutes when no fresh sample exists, never under 60 seconds', async () => {
    const noSample = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' },
    });
    expect(untilMs(noSample)).toBe(NOW + 10 * MINUTE);

    await vi.advanceTimersByTimeAsync(11 * MINUTE);
    await writeUserGraphqlSample(4900, Date.now() + 10_000);
    const floored = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'primary' },
    });
    expect(untilMs(floored)).toBe(Date.now() + MINUTE);
  });

  it('lets an x-ratelimit-reset header win for a primary refusal', async () => {
    await writeUserGraphqlSample(4956, NOW + 40 * MINUTE);
    const resetAtSec = Math.floor((NOW + 30 * MINUTE) / 1000);
    const pause = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pr-cache', refusal: { kind: 'primary', resetAtSec },
    });
    expect(untilMs(pause)).toBe(resetAtSec * 1000);
  });

  it('doubles consecutive secondary pauses 60 → 120 → 240 seconds, capped at 15 minutes', async () => {
    const durations: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const start = Date.now();
      const pause = await recordGitHubRefusal({
        pool: 'user', bucket: 'rest', caller: 'ci-repair', refusal: { kind: 'secondary' },
      });
      durations.push((untilMs(pause) - start) / 1000);
      await vi.advanceTimersByTimeAsync(untilMs(pause) - Date.now() + 1_000);
    }
    expect(durations).toEqual([60, 120, 240, 480, 900, 900]);

    await vi.advanceTimersByTimeAsync(31 * MINUTE);
    const reset = await recordGitHubRefusal({
      pool: 'user', bucket: 'rest', caller: 'ci-repair', refusal: { kind: 'secondary' },
    });
    expect(untilMs(reset) - Date.now()).toBe(60_000);
  });

  it('lets retry-after win for a secondary refusal', async () => {
    const pause = await recordGitHubRefusal({
      pool: 'pat', bucket: 'rest', caller: 'tracker-client', refusal: { kind: 'secondary', retryAfterSec: 30 },
    });
    expect(untilMs(pause)).toBe(NOW + 30_000);
  });

  it('ignores an hourly reset one hour out on a secondary refusal and pauses 60 seconds', async () => {
    const resetAtSec = Math.floor((NOW + 60 * MINUTE) / 1000);
    const pause = await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pr-sync', refusal: { kind: 'secondary', resetAtSec },
    });
    expect(untilMs(pause)).toBe(NOW + 60_000);
  });

  it('blocks only non-essential callers on the exact paused pool and bucket', async () => {
    await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pipeline-membership', refusal: { kind: 'primary' },
    });

    expect(() => assertGitHubCallAllowed('pipeline-membership', 'user', 'graphql'))
      .toThrowError(GitHubQuotaPausedError);
    expect(() => assertGitHubCallAllowed('pipeline-membership', 'user', 'graphql'))
      .toThrowError(/GitHub graphql calls paused until \d{2}:\d{2} \(rate limit\)/);
    expect(() => assertGitHubCallAllowed('agent', 'user', 'graphql')).not.toThrow();
    expect(() => assertGitHubCallAllowed('other', 'user', 'graphql')).not.toThrow();
    expect(() => assertGitHubCallAllowed('pipeline-membership', 'user', 'rest')).not.toThrow();
    expect(() => assertGitHubCallAllowed('pipeline-membership', 'app', 'graphql')).not.toThrow();

    await vi.advanceTimersByTimeAsync(10 * MINUTE + 1);
    expect(() => assertGitHubCallAllowed('pipeline-membership', 'user', 'graphql')).not.toThrow();
    expect(readActivePause()).toEqual([]);
  });

  it('does not let a pat REST pause block the app or user REST pools', async () => {
    await recordGitHubRefusal({
      pool: 'pat', bucket: 'rest', caller: 'issue-poller', refusal: { kind: 'primary' },
    });
    expect(() => assertGitHubCallAllowed('issue-poller', 'pat', 'rest')).toThrowError(GitHubQuotaPausedError);
    expect(() => assertGitHubCallAllowed('pipeline-membership', 'app', 'rest')).not.toThrow();
    expect(() => assertGitHubCallAllowed('pipeline-membership', 'user', 'rest')).not.toThrow();
  });

  it('appends the refused call to the ledger with its refusal outcome', async () => {
    await recordGitHubRefusal({
      pool: 'user', bucket: 'graphql', caller: 'pr-cache', refusal: { kind: 'primary' },
    });
    await recordGitHubRefusal({
      pool: 'user', bucket: 'rest', caller: 'ci-repair', refusal: { kind: 'secondary' },
    });
    const entries = readLedgerWindow(Date.now());
    expect(entries.map((e) => [e.caller, e.kind, e.outcome])).toEqual([
      ['pr-cache', 'call', 'rate_limited'],
      ['ci-repair', 'call', 'secondary_limited'],
    ]);
  });

  it('notifies each listener once per refusal, and a throwing listener does not fail the record', async () => {
    const events: unknown[] = [];
    const offThrowing = onGitHubRefusal(() => {
      throw new Error('listener boom');
    });
    const off = onGitHubRefusal((event) => events.push(event));
    try {
      await expect(recordGitHubRefusal({
        pool: 'user', bucket: 'graphql', caller: 'pipeline-membership', refusal: { kind: 'primary' },
      })).resolves.toMatchObject({ pool: 'user', bucket: 'graphql' });
      await recordGitHubRefusal({
        pool: 'user', bucket: 'rest', caller: 'pr-sync', refusal: { kind: 'secondary' },
      });
    } finally {
      off();
      offThrowing();
    }

    expect(events).toEqual([
      { caller: 'pipeline-membership', pool: 'user', bucket: 'graphql', kind: 'primary', ownUsageLow: true },
      { caller: 'pr-sync', pool: 'user', bucket: 'rest', kind: 'secondary', ownUsageLow: true },
    ]);
  });

  it('reads no pause when pause.json is missing or corrupt', () => {
    expect(existsSync(join(getGitHubQuotaDir(), 'pause.json'))).toBe(false);
    expect(readActivePause()).toEqual([]);
    mkdirSync(getGitHubQuotaDir(), { recursive: true });
    writeFileSync(join(getGitHubQuotaDir(), 'pause.json'), '{"pauses":');
    expect(readActivePause()).toEqual([]);
    expect(() => assertGitHubCallAllowed('pr-sync', 'user', 'graphql')).not.toThrow();
  });
});
