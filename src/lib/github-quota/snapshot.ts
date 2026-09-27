/**
 * PAN-4264: build the operator-facing `GitHubQuotaSnapshot` from the ledger
 * and the pause file. The dashboard publishes it (read model +
 * `GET /api/github-quota`); `pan doctor github-quota` prints the same data.
 */

import {
  GITHUB_QUOTA_BUCKETS,
  GITHUB_QUOTA_CALLERS,
  GITHUB_QUOTA_POOLS,
  type GitHubQuotaCaller,
  type GitHubQuotaCallerUsage,
  type GitHubQuotaSample,
  type GitHubQuotaSnapshot,
} from '@overdeck/contracts';
import {
  aggregateLedger,
  computeOwnUsageLow,
  readLedgerWindow,
  type LedgerAggregate,
  type LedgerEntry,
} from './ledger.js';
import { readActivePause } from './pause-gate.js';

const HOUR_MS = 3_600_000;
const KNOWN_CALLERS: ReadonlySet<string> = new Set(GITHUB_QUOTA_CALLERS);

/**
 * Per-caller usage, highest total points first. A caller name outside the
 * closed list (a hand-edited or foreign ledger line) is folded into `other`.
 */
export function callerUsage(aggregate: LedgerAggregate): GitHubQuotaCallerUsage[] {
  const merged = new Map<GitHubQuotaCaller, GitHubQuotaCallerUsage>();
  for (const [name, usage] of Object.entries(aggregate.byCaller)) {
    if (!usage) continue;
    const caller = (KNOWN_CALLERS.has(name) ? name : 'other') as GitHubQuotaCaller;
    const previous = merged.get(caller);
    merged.set(caller, {
      caller,
      graphql: {
        points: (previous?.graphql.points ?? 0) + usage.graphql.points,
        calls: (previous?.graphql.calls ?? 0) + usage.graphql.calls,
      },
      rest: {
        points: (previous?.rest.points ?? 0) + usage.rest.points,
        calls: (previous?.rest.calls ?? 0) + usage.rest.calls,
      },
      estimated: (previous?.estimated ?? false) || usage.estimated,
    });
  }
  const total = (u: GitHubQuotaCallerUsage) => u.graphql.points + u.rest.points;
  return [...merged.values()].sort((a, b) => total(b) - total(a) || a.caller.localeCompare(b.caller));
}

/** The latest sample per pool and bucket, flattened. */
export function latestSamples(aggregate: LedgerAggregate): GitHubQuotaSample[] {
  const samples: GitHubQuotaSample[] = [];
  for (const pool of GITHUB_QUOTA_POOLS) {
    for (const bucket of GITHUB_QUOTA_BUCKETS) {
      const sample = aggregate.samples[pool]?.[bucket];
      if (!sample) continue;
      samples.push({
        pool,
        bucket,
        ts: sample.ts,
        remaining: sample.remaining,
        limit: sample.limit,
        ...(sample.resetAt ? { resetAt: sample.resetAt } : {}),
      });
    }
  }
  return samples;
}

/**
 * User-pool GraphQL points the latest sample shows spent (`limit - remaining`)
 * that no metered caller claims: the sample's spent points minus the metered
 * user-pool GraphQL points between the sample's window start (`resetAt - 1h`)
 * and the sample, floored at 0. 0 when there is no sample.
 */
export function unattributedPoints(aggregate: LedgerAggregate, entries: readonly LedgerEntry[]): number {
  const sample = aggregate.samples.user?.graphql;
  if (!sample) return 0;
  const sampleMs = Date.parse(sample.ts);
  const resetMs = sample.resetAt ? Date.parse(sample.resetAt) : Number.NaN;
  const windowStartMs = Number.isFinite(resetMs) ? resetMs - HOUR_MS : sampleMs - HOUR_MS;
  let metered = 0;
  for (const entry of entries) {
    if (entry.kind !== 'call' || entry.pool !== 'user' || entry.bucket !== 'graphql') continue;
    const ms = Date.parse(entry.ts);
    if (ms >= windowStartMs && ms <= sampleMs) metered += entry.cost;
  }
  return Math.max(0, sample.limit - sample.remaining - metered);
}

/** Build the snapshot for `nowMs`. `login` comes from `getGitHubLogin()`. */
export function buildGitHubQuotaSnapshot(nowMs: number, login: string | null): GitHubQuotaSnapshot {
  const entries = readLedgerWindow(nowMs);
  const aggregate = aggregateLedger(entries);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    login,
    callers: callerUsage(aggregate),
    samples: latestSamples(aggregate),
    pauses: readActivePause(nowMs),
    ownUsageLow: computeOwnUsageLow(aggregate, nowMs),
    unattributed: unattributedPoints(aggregate, entries),
    refusals: { ...aggregate.refusals },
  };
}
