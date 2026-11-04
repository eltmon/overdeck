/**
 * Recompute one issue's derived state from a fresh PR listing (PAN-4457). Called when the review door
 * accepts a request — `pan done` reaches it right after opening the PR — so the issue row's PR badge
 * appears in seconds instead of waiting for the next tracker change. Never throws.
 */
import { invalidateRepoPullRequests } from '../../../lib/overdeck/derived-issue-state.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getSharedIssueService } from './issue-service-singleton.js';

export function refreshIssuePullRequestStateNow(issueId: string): void {
  try {
    const project = resolveProjectFromIssueSync(issueId);
    if (project) invalidateRepoPullRequests(project.projectPath);
    getSharedIssueService().scheduleDerivedStateRefreshForIssues([{ identifier: issueId.toUpperCase() }]);
  } catch (error) {
    console.warn(`[issue-pr-refresh] ${issueId}: refresh failed:`, error);
  }
}

/**
 * PAN-5036: drop the issue's repo PR listing when a `review.verdict` APPROVED is
 * journaled, so the auto-merge scheduler's next pass judges the approved PR
 * against fresh checks instead of a listing cached before the approval. The
 * dashboard's pipeline handler calls it for every journal entry, including
 * those a reviewer's CLI process forwards. Never throws.
 */
export function invalidatePullRequestListingOnApproval(entry: { type: string; issueId: string; data?: Record<string, unknown> }): void {
  if (entry.type !== 'review.verdict' || entry.data?.verdict !== 'APPROVED') return;
  try {
    const project = resolveProjectFromIssueSync(entry.issueId);
    if (project) invalidateRepoPullRequests(project.projectPath);
  } catch (error) {
    console.warn(`[issue-pr-refresh] ${entry.issueId}: listing invalidation failed:`, error);
  }
}
