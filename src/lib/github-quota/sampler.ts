/**
 * PAN-4264: sample GitHub's `/rate_limit` every 5 minutes.
 *
 * `/rate_limit` is free, so sampling never spends the quota it measures. Each
 * sample writes one `kind: 'sample'` ledger line per bucket (`graphql` and
 * `core` → `rest`) for the user pool (`gh api rate_limit`) and, when the
 * GitHub App is configured, for the app pool. The pause gate reads these to
 * tell a visible exhausted limit from a hidden per-user one, and the snapshot
 * reports the latest sample per pool and bucket.
 *
 * `quota-sampler` is an essential caller: the sampler keeps running during a
 * pause, which is exactly when the operator needs the numbers.
 */

import type { GitHubQuotaBucket, GitHubQuotaPool } from '@overdeck/contracts';
import { getAppRateLimit, isGitHubAppConfigured } from '../github-app.js';
import { appendLedgerEntry } from './ledger.js';
import { runGh, type GhExecFn } from './run-gh.js';

/** First sample this long after start, so boot traffic settles first. */
export const QUOTA_SAMPLER_INITIAL_DELAY_MS = 2 * 60_000;
export const QUOTA_SAMPLER_INTERVAL_MS = 5 * 60_000;

interface RateLimitResource {
  limit?: unknown;
  remaining?: unknown;
  reset?: unknown;
}

interface RateLimitResponse {
  resources?: { core?: RateLimitResource; graphql?: RateLimitResource };
}

export interface GitHubQuotaSamplerDeps {
  exec?: GhExecFn;
  isAppConfigured?: () => boolean;
  readAppRateLimit?: () => Promise<unknown>;
}

async function writeSamples(pool: GitHubQuotaPool, response: unknown, nowMs: number): Promise<void> {
  const resources = (response as RateLimitResponse | null)?.resources;
  const buckets: Array<[GitHubQuotaBucket, RateLimitResource | undefined]> = [
    ['graphql', resources?.graphql],
    ['rest', resources?.core],
  ];
  for (const [bucket, resource] of buckets) {
    if (typeof resource?.limit !== 'number' || typeof resource.remaining !== 'number') continue;
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
      ...(typeof resource.reset === 'number' ? { resetAt: new Date(resource.reset * 1000).toISOString() } : {}),
    });
  }
}

/** Take one sample of every configured pool. Never throws (NFR-2). */
export async function sampleGitHubRateLimits(deps: GitHubQuotaSamplerDeps = {}): Promise<void> {
  const nowMs = Date.now();
  try {
    const { stdout } = await runGh(['api', 'rate_limit'], {
      caller: 'quota-sampler',
      timeout: 15_000,
      ...(deps.exec ? { exec: deps.exec } : {}),
      onSuccess: () => ({ cost: 0, estimated: false }),
    });
    await writeSamples('user', JSON.parse(stdout), nowMs);
  } catch {
    // gh missing, unauthenticated or offline: no user-pool sample this tick.
  }

  try {
    if ((deps.isAppConfigured ?? isGitHubAppConfigured)()) {
      await writeSamples('app', await (deps.readAppRateLimit ?? getAppRateLimit)(), nowMs);
    }
  } catch {
    // App misconfigured or unreachable: no app-pool sample this tick.
  }
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
