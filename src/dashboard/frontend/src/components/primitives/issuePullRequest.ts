import { parsePullRequestRef, type DerivedPrState } from '@overdeck/contracts';
import type { PullRequestBadgeLink } from './PullRequestBadge';

/** The issue's PR (derived issue state) as a badge link; null when there is none or its URL is unusable. */
export function issuePullRequestBadgeLink(
  pr: DerivedPrState | undefined,
  resourcePrs: ReadonlyArray<{ number: number; title: string; isDraft: boolean }> = [],
): PullRequestBadgeLink | null {
  if (!pr) return null;
  const ref = parsePullRequestRef(pr.url);
  if (!ref) return null;
  const listed = resourcePrs.find((candidate) => candidate.number === pr.number);
  return {
    url: pr.url, number: pr.number, repository: ref.repository,
    snapshot: {
      state: pr.merged ? 'merged' : 'open', isDraft: listed?.isDraft ?? false, title: listed?.title ?? '',
      headBranch: null, baseBranch: null, reviewState: pr.reviewState, checks: pr.checks, mergeable: pr.mergeable,
      additions: null, deletions: null, changedFiles: null, author: null,
      updatedAt: null, mergedAt: null, closedAt: null, syncedAt: '',
    },
  };
}
