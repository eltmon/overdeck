/**
 * The GitHub PR listing (PAN-5042): one cached `gh pr list` per repo, plus the
 * stale-while-revalidate read board reads use. Moved out of
 * `derived-issue-state.ts` unchanged.
 */

import { createSettledTtlPromiseCache } from '../concurrency.js';
import { runGh } from '../github-quota/run-gh.js';
import { prListingTtlMs, shouldListPullRequests } from './pr-cache-policy.js';

/** How long a repo's PR listing is served before the forge is read again. */
export const PR_CACHE_TTL_MS = 30_000;

/**
 * How old a settled PR listing may be and still answer a board read while a
 * refresh runs behind it (PAN-3925). One `gh pr list --state all` with
 * `statusCheckRollup` takes ~11s on a busy repo, so a hard TTL expiry made
 * every read after it wait for the forge.
 */
export const PR_LISTING_MAX_STALE_MS = 2 * 60_000;

export interface GhPrRow {
  number?: number;
  url?: string;
  state?: string;
  mergedAt?: string | null;
  mergeable?: string;
  reviewDecision?: string | null;
  reviewRequests?: unknown[];
  statusCheckRollup?: Array<{ status?: string; conclusion?: string | null; state?: string }>;
  title?: string;
  headRefName?: string;
  isDraft?: boolean;
  baseRefName?: string;
  updatedAt?: string | null;
  closedAt?: string | null;
  author?: { login?: string } | null;
  headRefOid?: string | null;
}

const GH_PR_FIELDS = 'number,url,title,state,mergedAt,mergeable,headRefName,headRefOid,baseRefName,isDraft,reviewDecision,reviewRequests,statusCheckRollup,updatedAt,closedAt,author';

/**
 * One `gh pr list` per repo, cached briefly — the batch door's forge read.
 * PAN-4291: a listing with no open PR is cached for `PR_CACHE_IDLE_TTL_MS`
 * instead, since nothing in it can change without a new PR opening.
 */
const cachedRepoPullRequests = createSettledTtlPromiseCache<string, readonly GhPrRow[] | null>(
  PR_CACHE_TTL_MS,
  undefined,
  (rows) => prListingTtlMs(rows, PR_CACHE_TTL_MS),
);

/** The last listing each repo answered successfully, and when (PAN-3925). */
const lastRepoPullRequests = new Map<string, { readonly rows: readonly GhPrRow[]; readonly settledAt: number }>();

/** The repo's PR listing; empty when the read failed. */
export async function listRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[]> {
  return (await readRepoPullRequests(projectPath)) ?? [];
}

/** Drop the cached PR listing for one repo so the next read goes to the forge (PAN-4457). */
export function invalidateRepoPullRequests(projectPath: string): void {
  cachedRepoPullRequests.invalidate(projectPath);
}

/**
 * The repo's PR listing, or null when the read failed (rate limit, auth,
 * network), so a caller that backs off can tell "failed" from "no PRs".
 */
export async function readRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[] | null> {
  return cachedRepoPullRequests(projectPath, async () => {
    try {
      // PAN-4291: no tracker means gh could never answer; a `git remote`
      // failure reads as failed too (never cached as a false "no remote"),
      // landing in the catch below like a pause or refusal — "failed" (null),
      // never "no PRs".
      if (!(await shouldListPullRequests(projectPath))) return [];
      // PAN-4264: metered as caller pr-cache; a pause or refusal lands in the
      // catch below and reads as "failed" (null), never as "no PRs".
      const { stdout } = await runGh([
        'pr', 'list', '--state', 'all', '--limit', '100', '--json', GH_PR_FIELDS,
      ], { caller: 'pr-cache', cwd: projectPath, timeout: 20_000 });
      const rows = JSON.parse(stdout || '[]') as GhPrRow[];
      lastRepoPullRequests.set(projectPath, { rows, settledAt: Date.now() });
      return rows;
    } catch {
      return null;
    }
  });
}

/**
 * The repo's PR listing for board reads: stale-while-revalidate over
 * `listRepoPullRequests` (PAN-3925). Inside the TTL this is the cached
 * listing. Past it, the last good listing answers at once while one refresh
 * runs behind it, until that listing is older than `maxStaleMs`; then the read
 * waits for the forge. A failed refresh keeps serving the last good listing
 * inside that bound instead of an empty one. Gates that act on readiness keep
 * `listRepoPullRequests`.
 */
export async function listRepoPullRequestsStaleOk(
  projectPath: string,
  maxStaleMs: number = PR_LISTING_MAX_STALE_MS,
): Promise<readonly GhPrRow[]> {
  const fresh = listRepoPullRequests(projectPath);
  const last = lastRepoPullRequests.get(projectPath);
  if (!last || Date.now() - last.settledAt > maxStaleMs) return fresh;
  return last.rows;
}
