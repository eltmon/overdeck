/**
 * PAN-4264 Work Item 1: the GitHub quota ledger — append, windowed read,
 * aggregation, hour-file pruning, and the ownUsageLow predicate.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  aggregateLedger,
  appendLedgerEntry,
  computeOwnUsageLow,
  getGitHubQuotaDir,
  ledgerFilePath,
  OWN_USAGE_LOW_POINTS,
  pruneLedger,
  readLedgerWindow,
  SAMPLE_FRESH_MS,
  type LedgerEntry,
} from '../../../../src/lib/github-quota/ledger.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 27, 15, 30);

function call(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    ts: new Date(NOW - 60_000).toISOString(),
    pid: 1,
    kind: 'call',
    caller: 'pipeline-membership',
    pool: 'user',
    bucket: 'graphql',
    cost: 1,
    estimated: false,
    outcome: 'ok',
    ...overrides,
  };
}

function sample(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return call({ kind: 'sample', caller: 'quota-sampler', cost: 0, remaining: 4000, limit: 5000, ...overrides });
}

describe('GitHub quota ledger (PAN-4264)', () => {
  let home: string;
  const originalHome = process.env.OVERDECK_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-github-quota-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('reads back an appended call and aggregates its points under its caller and bucket', async () => {
    const ts = new Date(Date.now() - 1_000).toISOString();
    await appendLedgerEntry({
      ts,
      kind: 'call',
      caller: 'pr-sync',
      pool: 'user',
      bucket: 'graphql',
      cost: 7,
      estimated: false,
      outcome: 'ok',
    });

    const entries = readLedgerWindow(Date.now());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ts, pid: process.pid, caller: 'pr-sync', cost: 7 });

    const aggregate = aggregateLedger(entries);
    expect(aggregate.byCaller['pr-sync']?.graphql).toEqual({ points: 7, calls: 1 });
    expect(aggregate.byCaller['pr-sync']?.rest).toEqual({ points: 0, calls: 0 });
    expect(aggregate.byPool.user.graphql).toEqual({ points: 7, calls: 1 });
  });

  it('reads the window across the previous and current hour files', () => {
    const dir = getGitHubQuotaDir();
    mkdirSync(dir, { recursive: true });
    const inPrevious = call({ ts: new Date(NOW - 40 * 60_000).toISOString(), cost: 2 });
    const tooOld = call({ ts: new Date(NOW - 70 * 60_000).toISOString(), cost: 100 });
    const inCurrent = call({ ts: new Date(NOW - 5 * 60_000).toISOString(), cost: 3 });
    writeFileSync(ledgerFilePath(NOW - HOUR), `${JSON.stringify(tooOld)}\n${JSON.stringify(inPrevious)}\n`);
    writeFileSync(ledgerFilePath(NOW), `${JSON.stringify(inCurrent)}\nnot json\n{"torn":\n`);

    const entries = readLedgerWindow(NOW);
    expect(entries.map((e) => e.cost)).toEqual([2, 3]);
  });

  it('counts every call entry at its cost, including agent-shim unknown outcomes and refusals', () => {
    const aggregate = aggregateLedger([
      call({ caller: 'agent', estimated: true, outcome: 'unknown' }),
      call({ caller: 'agent', estimated: true, outcome: 'unknown', bucket: 'rest' }),
      call({ outcome: 'rate_limited', cost: 1 }),
      call({ outcome: 'secondary_limited', cost: 1, pool: 'app', bucket: 'rest' }),
      call({ caller: 'tracker-client', pool: 'pat', bucket: 'rest', outcome: 'error' }),
    ]);

    expect(aggregate.byCaller.agent).toEqual({
      graphql: { points: 1, calls: 1 },
      rest: { points: 1, calls: 1 },
      estimated: true,
    });
    expect(aggregate.byCaller['pipeline-membership']?.graphql).toEqual({ points: 1, calls: 1 });
    expect(aggregate.byCaller['pipeline-membership']?.rest).toEqual({ points: 1, calls: 1 });
    expect(aggregate.byPool.user.graphql.points).toBe(2);
    expect(aggregate.byPool.pat.rest.points).toBe(1);
    expect(aggregate.refusals).toEqual({ primary: 1, secondary: 1 });
  });

  it('keeps the latest sample per pool and bucket and never counts samples as calls', () => {
    const aggregate = aggregateLedger([
      sample({ ts: new Date(NOW - 20 * 60_000).toISOString(), remaining: 3000 }),
      sample({ ts: new Date(NOW - 2 * 60_000).toISOString(), remaining: 2500, resetAt: '2026-09-27T16:00:00Z' }),
      sample({ ts: new Date(NOW - 10 * 60_000).toISOString(), remaining: 2800 }),
      sample({ pool: 'app', bucket: 'rest', remaining: 14000, limit: 15000 }),
    ]);

    expect(aggregate.samples.user?.graphql).toEqual({
      ts: new Date(NOW - 2 * 60_000).toISOString(),
      remaining: 2500,
      limit: 5000,
      resetAt: '2026-09-27T16:00:00Z',
    });
    expect(aggregate.samples.app?.rest?.remaining).toBe(14000);
    expect(aggregate.byCaller).toEqual({});
  });

  it('prunes ledger files older than three hours at an hour rollover and keeps the current and previous hour files', async () => {
    const dir = getGitHubQuotaDir();
    mkdirSync(dir, { recursive: true });
    const keep = [ledgerFilePath(NOW), ledgerFilePath(NOW - HOUR), ledgerFilePath(NOW - 2 * HOUR)];
    const drop = [ledgerFilePath(NOW - 3 * HOUR), ledgerFilePath(NOW - 5 * HOUR)];
    for (const path of [...keep, ...drop]) writeFileSync(path, '');
    writeFileSync(join(dir, 'pause.json'), '{}');

    await pruneLedger(NOW);

    for (const path of keep) expect(existsSync(path)).toBe(true);
    for (const path of drop) expect(existsSync(path)).toBe(false);
    expect(readdirSync(dir)).toContain('pause.json');
  });

  it('never throws when the ledger directory is missing', async () => {
    await expect(pruneLedger(NOW)).resolves.toBeUndefined();
    expect(readLedgerWindow(NOW)).toEqual([]);
  });

  describe('computeOwnUsageLow', () => {
    const freshTs = new Date(NOW - 60_000).toISOString();
    const lowUsage = [call({ cost: 10 })];
    const highUsage = [call({ cost: OWN_USAGE_LOW_POINTS })];

    it.each([
      { usage: 'low', remaining: 4500, expected: true, entries: lowUsage },
      { usage: 'low', remaining: 0, expected: false, entries: lowUsage },
      { usage: 'high', remaining: 4500, expected: false, entries: highUsage },
      { usage: 'high', remaining: 0, expected: false, entries: highUsage },
    ])('$usage own usage with a fresh sample of remaining=$remaining → $expected', ({ entries, remaining, expected }) => {
      const aggregate = aggregateLedger([...entries, sample({ ts: freshTs, remaining, limit: 5000 })]);
      expect(computeOwnUsageLow(aggregate, NOW)).toBe(expected);
    });

    it('treats a stale sample like no sample', () => {
      const staleTs = new Date(NOW - SAMPLE_FRESH_MS - 1_000).toISOString();
      const aggregate = aggregateLedger([...lowUsage, sample({ ts: staleTs, remaining: 0 })]);
      expect(computeOwnUsageLow(aggregate, NOW)).toBe(true);
      expect(computeOwnUsageLow(aggregateLedger(lowUsage), NOW)).toBe(true);
    });

    it('ignores usage in other pools', () => {
      const aggregate = aggregateLedger([call({ pool: 'pat', cost: 2000 }), call({ pool: 'app', cost: 2000 })]);
      expect(computeOwnUsageLow(aggregate, NOW)).toBe(true);
    });
  });
});
