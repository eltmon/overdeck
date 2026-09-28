/**
 * Choosing which PR a head branch stands for (PAN-4263).
 *
 * GitHub's pulls list and `gh pr list` both sort by creation date, so the
 * first row can be a newer closed PR while an older one is still open.
 */

import type { GitHubPullRequestForHead } from './github-app.js';

/** Newest timestamp first; a missing timestamp sorts last, then the higher PR number wins. */
function byNewest(
  timestamp: (pr: GitHubPullRequestForHead) => string | null,
): (a: GitHubPullRequestForHead, b: GitHubPullRequestForHead) => number {
  return (a, b) => {
    const ta = Date.parse(timestamp(a) ?? '') || 0;
    const tb = Date.parse(timestamp(b) ?? '') || 0;
    return tb - ta || b.number - a.number;
  };
}

/**
 * The PR a head branch stands for (PAN-4263). Open PRs first, most recently
 * updated; with `includeClosed`, then merged (most recent merge), then closed
 * (most recently updated). `null` when nothing qualifies.
 */
export function selectPullRequestForHead(
  prs: readonly GitHubPullRequestForHead[],
  options: { includeClosed: boolean },
): GitHubPullRequestForHead | null {
  const open = prs.filter((pr) => pr.state === 'open').sort(byNewest((pr) => pr.updatedAt));
  if (open[0]) return open[0];
  if (!options.includeClosed) return null;
  const merged = prs.filter((pr) => pr.state !== 'open' && pr.merged).sort(byNewest((pr) => pr.mergedAt));
  if (merged[0]) return merged[0];
  const closed = prs.filter((pr) => pr.state !== 'open' && !pr.merged).sort(byNewest((pr) => pr.updatedAt));
  return closed[0] ?? null;
}
