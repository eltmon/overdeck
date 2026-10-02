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
