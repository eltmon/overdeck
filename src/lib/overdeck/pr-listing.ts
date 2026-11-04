/**
 * The GitHub PR listing (PAN-5042): a cached open read (every field) and a
 * cached closed read (no `statusCheckRollup`/`reviewRequests`/`mergeable`)
 * per repo, combined for the full listing, plus the stale-while-revalidate
 * read board reads use.
 */

import { createSettledTtlPromiseCache } from '../concurrency.js';
import { runGh } from '../github-quota/run-gh.js';
import { prListingTtlMs, PR_CACHE_IDLE_TTL_MS, shouldListPullRequests } from './pr-cache-policy.js';

/** How long a repo's PR listing is served before the forge is read again. */
export const PR_CACHE_TTL_MS = 30_000;

/**
 * How old a settled PR listing may be and still answer a board read while a
 * refresh runs behind it (PAN-3925). The combined read is two sequential `gh
 * pr list` calls — open (every field) then closed (no `statusCheckRollup`,
 * `reviewRequests`, or `mergeable`) — after one combined `--state all` call
 * with `statusCheckRollup` answered an HTTP 504 from GitHub's GraphQL gateway
 * past ~11s on a busy repo (PAN-5042), so a hard TTL expiry made every read
 * after it wait for the forge.
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

/** The closed-PR read drops the three fields only an open PR's status needs. */
const GH_CLOSED_PR_FIELDS = 'number,url,title,state,mergedAt,headRefName,headRefOid,baseRefName,isDraft,reviewDecision,updatedAt,closedAt,author';

interface SettledListing {
  readonly rows: readonly GhPrRow[];
  readonly settledAt: number;
}

/**
 * The open-PR read, cached briefly — the batch door's forge read and every
 * caller that only needs open PRs (PAN-5042). PAN-4291: a listing with no
 * open PR is cached for `PR_CACHE_IDLE_TTL_MS` instead, since nothing in it
 * can change without a new PR opening.
 */
const cachedOpenPullRequests = createSettledTtlPromiseCache<string, SettledListing | null>(
  PR_CACHE_TTL_MS,
  undefined,
  (listing) => prListingTtlMs(listing?.rows ?? null, PR_CACHE_TTL_MS),
);

/**
 * The closed-PR read, cached for `PR_CACHE_IDLE_TTL_MS` once it settles —
 * closed/merged PRs in this window don't change — but for only
 * `PR_CACHE_TTL_MS` on a failed read, so a transient failure retries at the
 * normal cadence instead of for five minutes.
 */
const cachedClosedPullRequests = createSettledTtlPromiseCache<string, SettledListing | null>(
  PR_CACHE_TTL_MS,
  undefined,
  (listing) => (listing ? PR_CACHE_IDLE_TTL_MS : PR_CACHE_TTL_MS),
);

/** The last combined listing each repo answered successfully, and when (PAN-3925). */
const lastRepoPullRequests = new Map<string, SettledListing>();

async function loadOpenPullRequests(projectPath: string): Promise<SettledListing | null> {
  try {
    // PAN-4291: no tracker means gh could never answer; a `git remote`
    // failure reads as failed too (never cached as a false "no remote"),
    // landing in the catch below like a pause or refusal — "failed" (null),
    // never "no PRs".
    if (!(await shouldListPullRequests(projectPath))) return { rows: [], settledAt: Date.now() };
    // PAN-4264: metered as caller pr-cache; a pause or refusal lands in the
    // catch below and reads as "failed" (null), never as "no PRs".
    const { stdout } = await runGh([
      'pr', 'list', '--state', 'open', '--limit', '100', '--json', GH_PR_FIELDS,
    ], { caller: 'pr-cache', cwd: projectPath, timeout: 20_000 });
    const rows = JSON.parse(stdout || '[]') as GhPrRow[];
    return { rows, settledAt: Date.now() };
  } catch {
    return null;
  }
}

async function loadClosedPullRequests(projectPath: string): Promise<SettledListing | null> {
  try {
    if (!(await shouldListPullRequests(projectPath))) return { rows: [], settledAt: Date.now() };
    const { stdout } = await runGh([
      'pr', 'list', '--state', 'closed', '--limit', '100', '--json', GH_CLOSED_PR_FIELDS,
    ], { caller: 'pr-cache', cwd: projectPath, timeout: 20_000 });
    const rows = JSON.parse(stdout || '[]') as GhPrRow[];
    return { rows, settledAt: Date.now() };
  } catch {
    return null;
  }
}

/**
 * Merge the open and closed listings into one, by PR number. A number in
 * both listings keeps the row from the one that settled later — open wins
 * only when it settled strictly after closed, otherwise closed wins (the
 * common case: closed is awaited after open, so it is the fresher read).
 */
function combineListings(open: SettledListing, closed: SettledListing): readonly GhPrRow[] {
  const openWins = open.settledAt > closed.settledAt;
  const byNumber = new Map<number, GhPrRow>();
  for (const row of closed.rows) {
    if (typeof row.number === 'number') byNumber.set(row.number, row);
  }
  for (const row of open.rows) {
    if (typeof row.number !== 'number') continue;
    if (openWins || !byNumber.has(row.number)) byNumber.set(row.number, row);
  }
  return [...byNumber.values()].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
}

/** The repo's open PRs, or null when the read failed. Never reads the closed listing. */
export async function readOpenRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[] | null> {
  const open = await cachedOpenPullRequests(projectPath, () => loadOpenPullRequests(projectPath));
  return open?.rows ?? null;
}

/** The repo's PR listing; empty when the read failed. */
export async function listRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[]> {
  return (await readRepoPullRequests(projectPath)) ?? [];
}

/** Drop the cached PR listings for one repo so the next read goes to the forge (PAN-4457). */
export function invalidateRepoPullRequests(projectPath: string): void {
  cachedOpenPullRequests.invalidate(projectPath);
  cachedClosedPullRequests.invalidate(projectPath);
}

/**
 * The repo's full PR listing (open and closed combined), or null when either
 * read failed (rate limit, auth, network), so a caller that backs off can
 * tell "failed" from "no PRs". The closed read runs only after the open read
 * settles — never in parallel — since a closed PR that reopened must lose to
 * the open listing's fresher answer.
 */
export async function readRepoPullRequests(projectPath: string): Promise<readonly GhPrRow[] | null> {
  const open = await cachedOpenPullRequests(projectPath, () => loadOpenPullRequests(projectPath));
  if (!open) return null;
  const closed = await cachedClosedPullRequests(projectPath, () => loadClosedPullRequests(projectPath));
  if (!closed) return null;
  const rows = combineListings(open, closed);
  lastRepoPullRequests.set(projectPath, { rows, settledAt: open.settledAt });
  return rows;
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
