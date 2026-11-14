/**
 * Recompute one issue's derived state from a fresh PR listing (PAN-4457). Called when the review door
 * accepts a request — `pan done` reaches it right after opening the PR — so the issue row's PR badge
 * appears in seconds instead of waiting for the next tracker change. Never throws.
 * PAN-5224: a repo with no webhook coverage gets no other invalidation, so Overdeck's own
 * review-door and merge actions invalidate the membership open-PR snapshot and enqueue a
 * resource refresh here too — never just the repo PR listing.
 */
import { invalidateRepoPullRequests } from '../../../lib/overdeck/derived-issue-state.js';
import { invalidateOpenPullRequestsSnapshot } from '../../../lib/pipeline-membership-gather.js';
import { listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../../lib/projects.js';
import { getSharedIssueService } from './issue-service-singleton.js';
import { enqueueProjectResourceRefresh } from './project-resource-refresh-queue.js';

interface ResolvedProjectRefresh {
  project: ProjectConfig;
  /** The issue's routed path (`resolveProjectPath`), which may differ from `project.path` for an `issue_routing` project. */
  routedPath: string;
}

function resolveProjectConfig(issueId: string): ResolvedProjectRefresh | undefined {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return undefined;
  const project = listProjectsSync().find((entry) => entry.key === resolved.projectKey)?.config;
  return project ? { project, routedPath: resolved.projectPath } : undefined;
}

/** The derived refresh reads the issue's routed path, so an `issue_routing` project needs both invalidated. */
function invalidateListing({ project, routedPath }: ResolvedProjectRefresh): void {
  invalidateRepoPullRequests(project.path);
  if (routedPath !== project.path) invalidateRepoPullRequests(routedPath);
}

function invalidateMembershipSnapshot(project: ProjectConfig): void {
  const [owner, repo] = project.github_repo?.split('/') ?? [];
  if (owner && repo) invalidateOpenPullRequestsSnapshot(owner, repo);
}

export function refreshIssuePullRequestStateNow(issueId: string): void {
  try {
    const resolved = resolveProjectConfig(issueId);
    if (resolved) {
      invalidateListing(resolved);
      invalidateMembershipSnapshot(resolved.project);
      enqueueProjectResourceRefresh(resolved.project, 'review-door');
    }
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
 * those a reviewer's CLI process forwards. PAN-5224: a `merge.completed` entry
 * additionally invalidates the membership open-PR snapshot, schedules a
 * derived-state refresh, and enqueues a resource refresh — the same gap a
 * webhook-covered repo closes through the coalescer. Never throws.
 */
export function invalidatePullRequestListingOnApproval(entry: { type: string; issueId: string; data?: Record<string, unknown> }): void {
  if (entry.type === 'review.verdict') {
    if (entry.data?.verdict !== 'APPROVED') return;
    try {
      const project = resolveProjectFromIssueSync(entry.issueId);
      if (project) invalidateRepoPullRequests(project.projectPath);
    } catch (error) {
      console.warn(`[issue-pr-refresh] ${entry.issueId}: listing invalidation failed:`, error);
    }
    return;
  }
  if (entry.type !== 'merge.completed') return;
  try {
    const resolved = resolveProjectConfig(entry.issueId);
    if (!resolved) return;
    invalidateListing(resolved);
    invalidateMembershipSnapshot(resolved.project);
    getSharedIssueService().scheduleDerivedStateRefreshForIssues([{ identifier: entry.issueId.toUpperCase() }]);
    enqueueProjectResourceRefresh(resolved.project, 'merge.completed');
  } catch (error) {
    console.warn(`[issue-pr-refresh] ${entry.issueId}: merge.completed refresh failed:`, error);
  }
}
