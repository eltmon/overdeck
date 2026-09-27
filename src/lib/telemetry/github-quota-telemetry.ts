/**
 * PAN-4264: GitHub quota telemetry.
 *
 * - `github_quota_sample`, hourly from the dashboard: this install's points
 *   per caller over the last hour, the lowest remaining GraphQL and REST
 *   budget, and refusal counts — all bucketed, never raw.
 * - `github_rate_limited`, from any process that records a refusal: at most
 *   one per 10 minutes per install. The throttle is cross-process, keyed on
 *   the mtime of `~/.overdeck/github-quota/last-rate-limited-event`.
 *
 * The pause gate never imports telemetry (NFR-8): telemetry subscribes with
 * `onGitHubRefusal` (dashboard boot and CLI start).
 */

import { stat, utimes, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bucketQuotaPoints,
  bucketQuotaRemaining,
  GITHUB_QUOTA_POOLS,
  type GitHubQuotaCaller,
  type GitHubQuotaSampleProperties,
  type TelemetryCountBucket,
  type TelemetryGitHubCaller,
} from '@overdeck/contracts';
import { aggregateLedger, getGitHubQuotaDir, readLedgerWindow, type LedgerAggregate } from '../github-quota/ledger.js';
import { onGitHubRefusal, type GitHubRefusalEvent } from '../github-quota/pause-gate.js';
import { callerUsage, unattributedPoints } from '../github-quota/snapshot.js';
import { getAnalyticsClientTypeForProcess, getAnalyticsService, trackAnalyticsTask, type AnalyticsService } from './service.js';

export const GITHUB_QUOTA_TELEMETRY_INTERVAL_MS = 60 * 60_000;
export const GITHUB_RATE_LIMITED_THROTTLE_MS = 10 * 60_000;

type QuotaAnalytics = Pick<AnalyticsService, 'capture'>;

export interface GitHubQuotaTelemetryDeps {
  analytics?: QuotaAnalytics;
  now?: () => number;
}

function analyticsFor(deps: GitHubQuotaTelemetryDeps): QuotaAnalytics {
  return deps.analytics ?? getAnalyticsService(getAnalyticsClientTypeForProcess());
}

function bucketCount(value: number): TelemetryCountBucket {
  if (value <= 0) return '0';
  if (value <= 2) return '1-2';
  if (value <= 5) return '3-5';
  if (value <= 10) return '6-10';
  return '11+';
}

function minRemaining(aggregate: LedgerAggregate, bucket: 'graphql' | 'rest'): number | undefined {
  const values = GITHUB_QUOTA_POOLS
    .map((pool) => aggregate.samples[pool]?.[bucket]?.remaining)
    .filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? Math.min(...values) : undefined;
}

/** The bucketed `github_quota_sample` properties for the last hour at `nowMs`. */
export function buildGitHubQuotaSampleProperties(nowMs: number): GitHubQuotaSampleProperties {
  const entries = readLedgerWindow(nowMs);
  const aggregate = aggregateLedger(entries);
  const points = new Map(callerUsage(aggregate).map((usage) => [usage.caller, usage]));
  const graphql = (caller: GitHubQuotaCaller) => bucketQuotaPoints(points.get(caller)?.graphql.points ?? 0);
  const rest = (caller: GitHubQuotaCaller) => bucketQuotaPoints(points.get(caller)?.rest.points ?? 0);
  return {
    graphql_pipeline_membership: graphql('pipeline-membership'),
    rest_pipeline_membership: rest('pipeline-membership'),
    graphql_pr_cache: graphql('pr-cache'),
    rest_pr_cache: rest('pr-cache'),
    graphql_pr_sync: graphql('pr-sync'),
    rest_pr_sync: rest('pr-sync'),
    graphql_ci_repair: graphql('ci-repair'),
    rest_ci_repair: rest('ci-repair'),
    graphql_issue_poller: graphql('issue-poller'),
    rest_issue_poller: rest('issue-poller'),
    graphql_close_out: graphql('close-out'),
    rest_close_out: rest('close-out'),
    graphql_tracker_client: graphql('tracker-client'),
    rest_tracker_client: rest('tracker-client'),
    graphql_app_rest: graphql('app-rest'),
    rest_app_rest: rest('app-rest'),
    graphql_agent: graphql('agent'),
    rest_agent: rest('agent'),
    graphql_other: graphql('other'),
    rest_other: rest('other'),
    graphql_unattributed: bucketQuotaPoints(unattributedPoints(aggregate, entries)),
    min_remaining_graphql: bucketQuotaRemaining(minRemaining(aggregate, 'graphql')),
    min_remaining_rest: bucketQuotaRemaining(minRemaining(aggregate, 'rest')),
    primary_limit_errors: bucketCount(aggregate.refusals.primary),
    secondary_limit_errors: bucketCount(aggregate.refusals.secondary),
  };
}

/** Capture one `github_quota_sample`. Never throws. */
export function captureGitHubQuotaSample(deps: GitHubQuotaTelemetryDeps = {}): void {
  try {
    analyticsFor(deps).capture('github_quota_sample', buildGitHubQuotaSampleProperties((deps.now ?? Date.now)()));
  } catch {
    // Telemetry must never fail the dashboard.
  }
}

/** Capture `github_quota_sample` every hour (unref'd). Returns the stop function. */
export function startGitHubQuotaTelemetry(
  intervalMs: number = GITHUB_QUOTA_TELEMETRY_INTERVAL_MS,
  deps: GitHubQuotaTelemetryDeps = {},
): () => void {
  const timer = setInterval(() => captureGitHubQuotaSample(deps), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function throttleFile(): string {
  return join(getGitHubQuotaDir(), 'last-rate-limited-event');
}

/**
 * Capture `github_rate_limited` unless one was sent in the last 10 minutes by
 * any process of this install. Resolves true when it captured. Never throws.
 */
export async function captureGitHubRateLimited(
  event: Pick<GitHubRefusalEvent, 'caller' | 'kind' | 'ownUsageLow'>,
  deps: GitHubQuotaTelemetryDeps = {},
): Promise<boolean> {
  try {
    const nowMs = (deps.now ?? Date.now)();
    const file = throttleFile();
    const last = await stat(file).then((stats) => stats.mtimeMs, () => null);
    if (last !== null && nowMs - last < GITHUB_RATE_LIMITED_THROTTLE_MS) return false;
    await mkdir(getGitHubQuotaDir(), { recursive: true });
    await writeFile(file, '');
    // Stamp the mtime with this process's clock, so the throttle compares like with like.
    await utimes(file, nowMs / 1000, nowMs / 1000);
    analyticsFor(deps).capture('github_rate_limited', {
      caller: event.caller.replace(/-/g, '_') as TelemetryGitHubCaller,
      kind: event.kind,
      own_usage_low: event.ownUsageLow,
    });
    return true;
  } catch {
    return false;
  }
}

/** Send `github_rate_limited` for every recorded refusal. Returns the unsubscribe function. */
export function registerGitHubRateLimitedTelemetry(deps: GitHubQuotaTelemetryDeps = {}): () => void {
  return onGitHubRefusal((event) => {
    void trackAnalyticsTask(captureGitHubRateLimited(event, deps));
  });
}
