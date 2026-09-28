/**
 * PAN-4291: price a `gh pr list` / `gh issue list` call by the GraphQL pages
 * GitHub actually walks to answer it, not a flat 1 point. `classifyGhInvocation`
 * already bills `gh pr`/`gh issue` commands to the `graphql` bucket; this
 * gives that estimate the same page-and-field-aware shape as the real cost.
 *
 * `gh` fetches one page of up to 100 rows per call; each extra `--json`
 * field GitHub joins in (a review, a status-check rollup, …) makes that page
 * more expensive. `priceGhListCall` prices every page `--limit` implies,
 * then — when the actual response is shorter than that — keeps only the
 * pages the response shows were really fetched.
 */

const PAGE_ROWS = 100;
const DEFAULT_LIMIT = 30;

/** `--json` fields GitHub bills as extra per-row cost in the GraphQL page. */
const FIELD_WEIGHTS: Record<string, number> = {
  statusCheckRollup: 2,
  reviewRequests: 1,
  labels: 1,
  assignees: 1,
  comments: 1,
  reviews: 1,
  latestReviews: 1,
  commits: 1,
  files: 1,
  projectCards: 1,
  projectItems: 1,
  closingIssuesReferences: 1,
};

function parseLimit(args: readonly string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--limit' || arg === '-L') {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return DEFAULT_LIMIT;
}

function parseJsonFields(args: readonly string[]): string[] {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    let value: string | undefined;
    if (arg === '--json') value = args[i + 1];
    else if (arg.startsWith('--json=')) value = arg.slice('--json='.length);
    if (value !== undefined) {
      return value.split(',').map((field) => field.trim()).filter(Boolean);
    }
  }
  return [];
}

function computeWeight(fields: readonly string[]): number {
  return fields.reduce((sum, field) => sum + (FIELD_WEIGHTS[field] ?? 0), 0);
}

/** Page sizes (each ≤100) `gh` walks to satisfy `limit`. */
function pageSizesForLimit(limit: number): number[] {
  const sizes: number[] = [];
  let remaining = limit;
  while (remaining > 0) {
    const size = Math.min(PAGE_ROWS, remaining);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

/** Keep only the pages a shorter-than-expected response shows were fetched. */
function truncateToActualRows(pageSizes: readonly number[], stdout: string | undefined): readonly number[] {
  if (stdout === undefined) return pageSizes;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return pageSizes;
  }
  if (!Array.isArray(parsed)) return pageSizes;
  const keep = Math.max(1, Math.ceil(parsed.length / PAGE_ROWS));
  return pageSizes.slice(0, keep);
}

function pageCost(pageSize: number, weight: number): number {
  return Math.max(1, Math.round((1 + pageSize * weight) / 100));
}

/**
 * The GraphQL point cost of a `gh pr list` / `gh issue list` call, or `null`
 * when `args` is not one of those two commands.
 */
export function priceGhListCall(args: readonly string[], stdout?: string): number | null {
  if (args[0] !== 'pr' && args[0] !== 'issue') return null;
  if (args[1] !== 'list') return null;

  const weight = computeWeight(parseJsonFields(args));
  const pageSizes = truncateToActualRows(pageSizesForLimit(parseLimit(args)), stdout);
  return pageSizes.reduce((sum, size) => sum + pageCost(size, weight), 0);
}
