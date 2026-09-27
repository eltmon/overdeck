import { Schema } from "effect"

// ─── GitHub API quota (PAN-4264) ─────────────────────────────────────────────
//
// Shared vocabulary for the GitHub quota ledger (`src/lib/github-quota/`), the
// dashboard snapshot, and `pan doctor github-quota`. The ledger records which
// named Overdeck subsystem ("caller") spent which GitHub limit ("pool" +
// "bucket"), so a rate-limit refusal can be explained instead of guessed at.

/**
 * The closed list of logical GitHub callers. A call made outside any
 * `withGitHubCaller` context is recorded as `other` (or `app-rest` when it
 * goes through the GitHub App REST door).
 */
export const GITHUB_QUOTA_CALLERS = [
  "pipeline-membership",
  "pr-cache",
  "pr-sync",
  "ci-repair",
  "issue-poller",
  "close-out",
  "tracker-client",
  "app-rest",
  "quota-sampler",
  "agent",
  "other",
] as const
export const GitHubQuotaCaller = Schema.Literals(GITHUB_QUOTA_CALLERS)
export type GitHubQuotaCaller = typeof GitHubQuotaCaller.Type

/**
 * Read-model pollers whose data can be stale for minutes without harm. Only
 * these callers are skipped while a pause is active; every other caller
 * (merge, verdict recording, tracker writes, agents) is essential and never
 * paused.
 */
export const NON_ESSENTIAL_GITHUB_CALLERS: ReadonlySet<GitHubQuotaCaller> = new Set<GitHubQuotaCaller>([
  "pipeline-membership",
  "pr-cache",
  "pr-sync",
  "ci-repair",
  "issue-poller",
  "close-out",
])

/**
 * The GitHub identity whose limit a call spends: `user` is the `gh` CLI token,
 * `pat` is the `GITHUB_TOKEN` personal access token, `app` is a GitHub App
 * installation token.
 */
export const GITHUB_QUOTA_POOLS = ["user", "pat", "app"] as const
export const GitHubQuotaPool = Schema.Literals(GITHUB_QUOTA_POOLS)
export type GitHubQuotaPool = typeof GitHubQuotaPool.Type

/** The limit counter inside a pool. `rest` is what GitHub calls `core`. */
export const GITHUB_QUOTA_BUCKETS = ["graphql", "rest"] as const
export const GitHubQuotaBucket = Schema.Literals(GITHUB_QUOTA_BUCKETS)
export type GitHubQuotaBucket = typeof GitHubQuotaBucket.Type

/** Primary = the hourly budget; secondary = GitHub's burst/abuse limit. */
export const GitHubRateLimitKind = Schema.Literals(["primary", "secondary"])
export type GitHubRateLimitKind = typeof GitHubRateLimitKind.Type

/** Points spent and calls made in one bucket. */
export const GitHubQuotaUsage = Schema.Struct({
  points: Schema.Number,
  calls: Schema.Number,
})
export type GitHubQuotaUsage = typeof GitHubQuotaUsage.Type

/** One caller's metered usage over the last hour. */
export const GitHubQuotaCallerUsage = Schema.Struct({
  caller: GitHubQuotaCaller,
  graphql: GitHubQuotaUsage,
  rest: GitHubQuotaUsage,
  /** True when any counted call had an estimated (not GitHub-reported) cost. */
  estimated: Schema.Boolean,
})
export type GitHubQuotaCallerUsage = typeof GitHubQuotaCallerUsage.Type

/** The latest `/rate_limit` (or header) reading for one pool and bucket. */
export const GitHubQuotaSample = Schema.Struct({
  pool: GitHubQuotaPool,
  bucket: GitHubQuotaBucket,
  /** ISO time the sample was taken. */
  ts: Schema.String,
  remaining: Schema.Number,
  limit: Schema.Number,
  /** ISO time the bucket's hourly window resets. */
  resetAt: Schema.optional(Schema.String),
})
export type GitHubQuotaSample = typeof GitHubQuotaSample.Type

/** An active pause on one pool and bucket (`~/.overdeck/github-quota/pause.json`). */
export const GitHubQuotaPause = Schema.Struct({
  pool: GitHubQuotaPool,
  bucket: GitHubQuotaBucket,
  kind: GitHubRateLimitKind,
  /** The caller whose refused call started the pause. */
  caller: GitHubQuotaCaller,
  /** ISO time the pause started. */
  since: Schema.String,
  /** ISO time the pause ends. */
  until: Schema.String,
})
export type GitHubQuotaPause = typeof GitHubQuotaPause.Type

/**
 * The operator-facing quota view — identical to the body of
 * `GET /api/github-quota`, so the pill, the banner and the CLI read one shape.
 * Derived runtime state: published with `emitOnly`, never persisted.
 */
export const GitHubQuotaSnapshot = Schema.Struct({
  /** ISO time the snapshot was built. */
  generatedAt: Schema.String,
  /** The `gh` account login. Local display only; never sent to telemetry. */
  login: Schema.NullOr(Schema.String),
  /** Per-caller usage in the last hour, highest total points first. */
  callers: Schema.Array(GitHubQuotaCallerUsage),
  /** The latest sample per pool and bucket. */
  samples: Schema.Array(GitHubQuotaSample),
  /** Active pauses; empty when GitHub calls are not paused. */
  pauses: Schema.Array(GitHubQuotaPause),
  /** True when this machine's own metered usage cannot explain a primary limit. */
  ownUsageLow: Schema.Boolean,
  /** User-pool GraphQL points the latest sample shows spent but no metered caller claims. */
  unattributed: Schema.Number,
  /** Refusals observed in the last hour. */
  refusals: Schema.Struct({ primary: Schema.Number, secondary: Schema.Number }),
})
export type GitHubQuotaSnapshot = typeof GitHubQuotaSnapshot.Type
