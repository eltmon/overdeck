/**
 * The project's ready set (PAN-3917 FR-9): the open PRs that are approved,
 * green and mergeable, by issue. Batches are assembled from it and the merge
 * queue orders it.
 *
 * Moved out of `derived-issue-state.ts` (PAN-4753 WI-4) so the GitLab and
 * polyrepo readers can grow here without pushing that file past its size cap.
 * This module imports from `derived-issue-state.ts`, never the reverse; the
 * server adapter (`services/derived-issue-state.ts`) re-exports it.
 */
import { issueIdFromBranch, prFromGhRow } from './derived-issue-state.js';
import { type GhPrRow, readOpenRepoPullRequests } from './pr-listing.js';

export { issueIdFromBranch };

/** One issue whose PR is ready to merge: approved, green, and mergeable. */
export interface ReadyIssue {
  readonly issueId: string;
  readonly title: string;
  readonly pr?: number;
}

/**
 * The project's ready set, from the same cached repo listing the batch door
 * uses. Readiness is approvals plus green checks plus forge mergeability, and
 * nothing else (FR-9, D3).
 */
export async function listReadyIssuesForProject(
  projectPath: string,
  deps: { readonly listPullRequests?: (projectPath: string) => Promise<readonly GhPrRow[]> } = {},
): Promise<ReadyIssue[]> {
  const rows = await (deps.listPullRequests ?? (async (p) => (await readOpenRepoPullRequests(p)) ?? []))(projectPath);
  const ready: ReadyIssue[] = [];
  for (const row of rows) {
    if (row.isDraft) continue;
    const issueId = issueIdFromBranch(row.headRefName);
    if (!issueId) continue;
    const pr = prFromGhRow(row);
    if (!pr || pr.merged) continue;
    // #4066 review: this is the UAT train's candidate set, which is mostly
    // issues held for UAT. The auto-merge scheduler never runs the gate for a
    // held issue, so the gate's cached answer would empty the train; it keeps
    // the forge's own decision. It merges nothing: every merge asks the gate.
    if (pr.reviewState !== 'approved' || pr.checks !== 'green' || pr.mergeable !== true) continue;
    ready.push({ issueId, title: row.title ?? issueId, pr: pr.number });
  }
  return ready;
}
