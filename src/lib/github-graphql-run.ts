import type { LedgerEntry } from './github-quota/ledger.js';
import { GitHubQuotaPausedError, GitHubRateLimitedError } from './github-quota/pause-gate.js';
import { runGh } from './github-quota/run-gh.js';

export const GH_GRAPHQL_RETRY_DELAY_MS = 1000;
export const GH_GRAPHQL_STDERR_LIMIT = 500;

export type GhExec = (args: string[]) => Promise<{ stdout: string }>;
export type Delay = (ms: number) => Promise<void>;

interface GhExecFailure {
  code?: number | string | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

/**
 * PAN-4264: the real cost of a GraphQL call, from a `rateLimit { cost
 * remaining resetAt limit }` selection in the response envelope. Returns `{}`
 * when the query did not select it, so the ledger keeps the estimate.
 */
export function readGraphqlRateLimit(stdout: string): Partial<LedgerEntry> {
  const parsed = JSON.parse(stdout) as {
    data?: { rateLimit?: { cost?: unknown; remaining?: unknown; limit?: unknown; resetAt?: unknown } | null } | null;
  };
  const rateLimit = parsed.data?.rateLimit;
  if (!rateLimit || typeof rateLimit.cost !== 'number') return {};
  return {
    cost: rateLimit.cost,
    estimated: false,
    ...(typeof rateLimit.remaining === 'number' ? { remaining: rateLimit.remaining } : {}),
    ...(typeof rateLimit.limit === 'number' ? { limit: rateLimit.limit } : {}),
    ...(typeof rateLimit.resetAt === 'string' ? { resetAt: rateLimit.resetAt } : {}),
  };
}

function defaultExec(args: string[]): Promise<{ stdout: string }> {
  return runGh(args, { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, onSuccess: readGraphqlRateLimit });
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Render a gh exec failure for operator eyes without the 50-alias query. */
export function describeGhGraphqlFailure(error: unknown, attempt: number): string {
  const { code, killed, stderr } = (error ?? {}) as GhExecFailure;
  const exitLabel = killed || code == null ? 'timeout' : `exit ${code}`;
  const trimmedStderr = typeof stderr === 'string' ? stderr.trim() : '';
  const detail = trimmedStderr.length > 0
    ? trimmedStderr.slice(0, GH_GRAPHQL_STDERR_LIMIT)
    : 'no stderr';
  return `gh api graphql failed (${exitLabel}, attempt ${attempt}): ${detail}`;
}

export async function runGitHubGraphql(
  query: string,
  exec: GhExec = defaultExec,
  delay: Delay = defaultDelay,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await exec(['api', 'graphql', '-f', `query=${query}`]);
      return stdout;
    } catch (error) {
      // A rate-limit refusal or an active pause is already typed and recorded
      // by the quota meter. Retrying would spend the quota it protects.
      if (error instanceof GitHubRateLimitedError || error instanceof GitHubQuotaPausedError) throw error;
      // gh exits non-zero when the GraphQL envelope carries per-field errors
      // (e.g. `issue(number: N)` where N is a PR — strike branches can point at
      // PR numbers), but it still prints the full response with partial data to
      // stdout. Surface that envelope so callers can use the resolvable fields
      // instead of failing the whole gather (the zero-membership regression).
      const stdout = (error as { stdout?: string }).stdout;
      let parsedEnvelope = false;
      if (typeof stdout === 'string' && stdout.length > 0) {
        try {
          const parsed = JSON.parse(stdout) as { data?: unknown };
          parsedEnvelope = true;
          if (parsed.data !== undefined && parsed.data !== null) return stdout;
        } catch {
          // stdout is not a GraphQL envelope — retry-eligible below
        }
      }
      // A parsed errors-only envelope (bad query, rate limit) is deterministic
      // and retrying burns quota; an unparseable stdout (network failure, gh
      // crash, timeout) is the intermittent class this retries once for.
      if (parsedEnvelope || attempt > 1) {
        throw new Error(describeGhGraphqlFailure(error, attempt), { cause: error });
      }
      await delay(GH_GRAPHQL_RETRY_DELAY_MS);
    }
  }
}
