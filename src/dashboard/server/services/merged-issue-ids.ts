/**
 * Which features already merged, for the UAT reconciler's status reason
 * (PAN-4753 WI-3).
 *
 * When a batch member leaves the ready set, the reconciler invalidates the
 * batch. If the member's PR merged, the stored reason says it "was merged on
 * its own, outside the batch"; otherwise it says it "is no longer ready to
 * merge". This module answers the first question from the cached GitHub PR
 * listing: merged rows whose head is `feature/<id>`.
 *
 * GitHub monorepo projects only. GitLab and polyrepo listings arrive with
 * WI-4 (PAN-3657); until then the reconciler omits the dep there and the
 * less specific reason is still correct.
 */
import type { GhPrRow } from '../../../lib/overdeck/pr-listing.js';
import { issueIdFromBranch } from '../../../lib/overdeck/derived-issue-state.js';

export interface MergedIssueIdsDeps {
  listRows?: (projectPath: string) => Promise<readonly GhPrRow[]>;
}

/** Upper-case issue ids whose `feature/<id>` PR merged, from the cached full listing. */
export async function mergedIssueIdsForGithubProject(
  projectPath: string,
  deps: MergedIssueIdsDeps = {},
): Promise<ReadonlySet<string>> {
  const listRows = deps.listRows
    ?? (await import('../../../lib/overdeck/pr-listing.js')).listRepoPullRequests;
  const ids = new Set<string>();
  for (const row of await listRows(projectPath)) {
    if (!row.mergedAt) continue;
    const id = issueIdFromBranch(row.headRefName);
    if (id) ids.add(id);
  }
  return ids;
}
