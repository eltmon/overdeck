/**
 * PAN-4264: sample GitHub's rate limits every 5 minutes.
 *
 * REST `/rate_limit` is free, so sampling never spends the quota it measures,
 * but its `resources.graphql` bucket can badly under-report the GraphQL
 * budget relative to the GraphQL API's own `rateLimit` field (PAN-4291) — so
 * the user pool's `graphql` bucket is sampled via `gh api graphql`'s
 * `rateLimit(dryRun: true)`, which is also free, while its `rest` bucket
 * still comes from REST `/rate_limit`. The app pool, which has no separate
 * GraphQL source wired up, still samples both buckets from REST. The pause
 * gate reads these to tell a visible exhausted limit from a hidden per-user
 * one, and the snapshot reports the latest sample per pool and bucket.
 *
 * `quota-sampler` is an essential caller: the sampler keeps running during a
 * pause, which is exactly when the operator needs the numbers. Every
 * successful user-pool sample also reconciles the active pause on its
 * bucket (`reconcileGitHubPauseWithSample`), so a pause lifts or is
 * corrected to the window's real reset as soon as a fresh sample lands,
 * rather than waiting out a hidden-limit guess. The REST and GraphQL
 * fetches run concurrently, but the two reconcile calls run REST-then-
 * GraphQL, sequentially, since both read-modify-write the same
 * `pause.json` and a concurrent pair could lose one bucket's update.
 */

import type { GitHubQuotaBucket, GitHubQuotaPool } from '@overdeck/contracts';
import { getAppRateLimit, isGitHubAppConfigured } from '../github-app.js';
import { appendLedgerEntry } from './ledger.js';
import { reconcileGitHubPauseWithSample } from './pause-gate.js';
import { runGh, type GhExecFn } from './run-gh.js';

/** First sample this long after start, so boot traffic settles first. */
export const QUOTA_SAMPLER_INITIAL_DELAY_MS = 2 * 60_000;
export const QUOTA_SAMPLER_INTERVAL_MS = 5 * 60_000;

/** `dryRun: true` reads the bucket without spending anything. */
const GRAPHQL_RATE_LIMIT_QUERY = 'query{rateLimit(dryRun:true){limit remaining resetAt}}';

interface RateLimitResource {
  limit?: unknown;
  remaining?: unknown;
  reset?: unknown;
}

interface RateLimitResponse {
  resources?: { core?: RateLimitResource; graphql?: RateLimitResource };
}

interface GraphQLRateLimitResponse {
  data?: { rateLimit?: { limit?: unknown; remaining?: unknown; resetAt?: unknown } };
}

export interface GitHubQuotaSamplerDeps {
  exec?: GhExecFn;
  isAppConfigured?: () => boolean;
  readAppRateLimit?: () => Promise<unknown>;
}

interface WrittenSample {
  remaining: number;
  resetAt?: string;
}

async function writeSample(
  pool: GitHubQuotaPool,
  bucket: GitHubQuotaBucket,
  resource: RateLimitResource | undefined,
  nowMs: number,
): Promise<WrittenSample | undefined> {
  if (typeof resource?.limit !== 'number' || typeof resource.remaining !== 'number') return undefined;
  const resetAt = typeof resource.reset === 'number' ? new Date(resource.reset * 1000).toISOString() : undefined;
  await appendLedgerEntry({
    ts: new Date(nowMs).toISOString(),
    kind: 'sample',
    caller: 'quota-sampler',
    pool,
    bucket,
    cost: 0,
    estimated: false,
    outcome: 'ok',
    remaining: resource.remaining,
    limit: resource.limit,
    ...(resetAt ? { resetAt } : {}),
  });
  return { remaining: resource.remaining, ...(resetAt ? { resetAt } : {}) };
}

/** Write REST-sourced samples for the given buckets (both, by default). */
async function writeRestSamples(
  pool: GitHubQuotaPool,
  response: unknown,
  nowMs: number,
  buckets: readonly GitHubQuotaBucket[] = ['graphql', 'rest'],
): Promise<void> {
  const resources = (response as RateLimitResponse | null)?.resources;
  const byBucket: Record<GitHubQuotaBucket, RateLimitResource | undefined> = {
    graphql: resources?.graphql,
    rest: resources?.core,
  };
  for (const bucket of buckets) {
    await writeSample(pool, bucket, byBucket[bucket], nowMs);
  }
}

/** Write the user pool's `graphql` sample from GraphQL's own `rateLimit`. */
async function writeGraphQLRateLimitSample(response: unknown, nowMs: number): Promise<WrittenSample | undefined> {
  const rateLimit = (response as GraphQLRateLimitResponse | null)?.data?.rateLimit;
  if (typeof rateLimit?.limit !== 'number' || typeof rateLimit.remaining !== 'number') return undefined;
  const resetAt = typeof rateLimit.resetAt === 'string' ? rateLimit.resetAt : undefined;
  await appendLedgerEntry({
    ts: new Date(nowMs).toISOString(),
    kind: 'sample',
    caller: 'quota-sampler',
    pool: 'user',
    bucket: 'graphql',
    cost: 0,
    estimated: false,
    outcome: 'ok',
    remaining: rateLimit.remaining,
    limit: rateLimit.limit,
    ...(resetAt ? { resetAt } : {}),
  });
  return { remaining: rateLimit.remaining, ...(resetAt ? { resetAt } : {}) };
}

/** Take one sample of every configured pool. Never throws (NFR-2). */
export async function sampleGitHubRateLimits(deps: GitHubQuotaSamplerDeps = {}): Promise<void> {
  const nowMs = Date.now();

  const sampleUserRest = async (): Promise<WrittenSample | undefined> => {
    try {
      const { stdout } = await runGh(['api', 'rate_limit'], {
        caller: 'quota-sampler',
        timeout: 15_000,
        ...(deps.exec ? { exec: deps.exec } : {}),
        onSuccess: () => ({ cost: 0, estimated: false }),
      });
      const resources = (JSON.parse(stdout) as RateLimitResponse | null)?.resources;
      return await writeSample('user', 'rest', resources?.core, nowMs);
    } catch {
      // gh missing, unauthenticated or offline: no user-pool rest sample this tick.
      return undefined;
    }
  };

  const sampleUserGraphQL = async (): Promise<WrittenSample | undefined> => {
    try {
      const { stdout } = await runGh(['api', 'graphql', '-f', `query=${GRAPHQL_RATE_LIMIT_QUERY}`], {
        caller: 'quota-sampler',
        timeout: 15_000,
        ...(deps.exec ? { exec: deps.exec } : {}),
        onSuccess: () => ({ cost: 0, estimated: false }),
      });
      return await writeGraphQLRateLimitSample(JSON.parse(stdout), nowMs);
    } catch {
      // GraphQL rateLimit query failed: no user-pool graphql sample this tick.
      return undefined;
    }
  };

  const sampleApp = async (): Promise<void> => {
    try {
      if ((deps.isAppConfigured ?? isGitHubAppConfigured)()) {
        await writeRestSamples('app', await (deps.readAppRateLimit ?? getAppRateLimit)(), nowMs);
      }
    } catch {
      // App misconfigured or unreachable: no app-pool sample this tick.
    }
  };

  // Independent network fetches and ledger writes run concurrently, but the
  // two user-pool pause reconciliations below run sequentially afterward
  // (PRD D1: REST sample first, then GraphQL) — both read-modify-write the
  // same pause.json, and running them concurrently could lose one bucket's
  // reconciliation to a last-writer-wins race.
  const [restWritten, graphqlWritten] = await Promise.all([sampleUserRest(), sampleUserGraphQL(), sampleApp()]);
  if (restWritten) await reconcileGitHubPauseWithSample({ pool: 'user', bucket: 'rest', ...restWritten }, nowMs);
  if (graphqlWritten) await reconcileGitHubPauseWithSample({ pool: 'user', bucket: 'graphql', ...graphqlWritten }, nowMs);
}

/**
 * Sample at +2 minutes, then every `intervalMs`. Timers are unref'd. Returns
 * the stop function.
 */
export function startGitHubQuotaSampler(
  intervalMs: number = QUOTA_SAMPLER_INTERVAL_MS,
  deps: GitHubQuotaSamplerDeps = {},
): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;
  const initial = setTimeout(() => {
    void sampleGitHubRateLimits(deps);
    interval = setInterval(() => {
      void sampleGitHubRateLimits(deps);
    }, intervalMs);
    interval.unref?.();
  }, QUOTA_SAMPLER_INITIAL_DELAY_MS);
  initial.unref?.();
  return () => {
    clearTimeout(initial);
    if (interval) clearInterval(interval);
  };
}
