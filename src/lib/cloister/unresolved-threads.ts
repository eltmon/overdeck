/**
 * Unresolved review threads per open PR (PAN-4753 WI-7, FR-15), for the
 * merge-train board's `unresolved_conversations` blocker.
 *
 * One GraphQL read per GitHub repo, cached per repo for
 * {@link UNRESOLVED_THREADS_TTL_MS}. The query asks for 30 open PRs with up to
 * 50 threads each, which GitHub prices at one point, so a board polled every
 * 15 s costs at most 30 points an hour per repo.
 *
 * Never fails the board: a failed or rate-limited read returns an empty map,
 * and the board then shows the other five blocker types for that poll.
 */
import { createSettledTtlPromiseCache } from '../concurrency.js';
import { runGh } from '../github-quota/run-gh.js';

/** How long one repo's thread counts are served before the forge is read again. */
export const UNRESOLVED_THREADS_TTL_MS = 2 * 60_000;

const QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { number reviewThreads(first: 50) { nodes { isResolved } } }
    }
  }
}`;

interface ThreadsResponse {
  data?: { repository?: { pullRequests?: { nodes?: Array<{
    number?: number;
    reviewThreads?: { nodes?: Array<{ isResolved?: boolean }> };
  }> } } };
}

export interface UnresolvedThreadsDeps {
  /** Runs `gh api graphql`; returns stdout. */
  gh?: (args: string[], cwd: string) => Promise<string>;
}

const cache = createSettledTtlPromiseCache<string, ReadonlyMap<number, number>>(UNRESOLVED_THREADS_TTL_MS);

async function defaultGh(args: string[], cwd: string): Promise<string> {
  return (await runGh(args, { caller: 'pr-cache', cwd, timeout: 20_000 })).stdout;
}

/** Parse the GraphQL answer into PR number → unresolved thread count (zeros omitted). */
export function parseUnresolvedThreads(stdout: string): Map<number, number> {
  const out = new Map<number, number>();
  const parsed = JSON.parse(stdout) as ThreadsResponse;
  for (const pr of parsed.data?.repository?.pullRequests?.nodes ?? []) {
    if (typeof pr.number !== 'number') continue;
    const open = (pr.reviewThreads?.nodes ?? []).filter((thread) => thread.isResolved === false).length;
    if (open > 0) out.set(pr.number, open);
  }
  return out;
}

/**
 * PR number → unresolved review threads for the repo `owner/name`, read from
 * `cwd`. Empty on any failure, never thrown.
 */
export async function listUnresolvedThreadCounts(
  repoSlug: string,
  cwd: string,
  deps: UnresolvedThreadsDeps = {},
): Promise<ReadonlyMap<number, number>> {
  const [owner, name] = repoSlug.split('/');
  if (!owner || !name) return new Map();
  const read = async (): Promise<ReadonlyMap<number, number>> => {
    const stdout = await (deps.gh ?? defaultGh)(
      ['api', 'graphql', '-f', `query=${QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`],
      cwd,
    );
    return parseUnresolvedThreads(stdout);
  };
  try {
    // Injected deps bypass the shared cache so tests stay independent.
    return deps.gh ? await read() : await cache(repoSlug, read);
  } catch {
    return new Map();
  }
}
