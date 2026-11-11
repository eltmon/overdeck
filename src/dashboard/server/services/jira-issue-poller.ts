/**
 * Jira issue poller for the dashboard read model (PAN-5152, FR-4).
 *
 * Reads the open issues of every `tracker: jira` project and formats them
 * as dashboard rows, the same shape the Rally poller produces. A failing
 * project is logged and skipped so the other projects' rows still arrive.
 * IssueDataService calls this on the Rally cadence (polling, not webhooks).
 */

import { Effect } from 'effect';
import type { Issue } from '../../../lib/tracker/interface.js';
import { createJiraTrackerForProject } from '../../../lib/tracker/factory.js';
import { findJiraProjectsAsync } from '../../../lib/tracker/tracker-projects.js';
import { displayStatusForCanonical } from './issue-status-mapping.js';

/** Format a Jira tracker Issue as a dashboard row. */
export function formatJiraIssue(issue: Issue, project: { key: string; name: string }): Record<string, unknown> {
  const canonical = issue.canonicalState ?? 'todo';
  return {
    id: `jira-${issue.id}`,
    identifier: issue.ref,
    title: issue.title,
    description: issue.description,
    status: displayStatusForCanonical(canonical),
    canonicalStatus: canonical,
    state: canonical,
    rawTrackerState: issue.rawState,
    priority: issue.priority ?? 3,
    assignee: issue.assignee ? { name: issue.assignee } : undefined,
    labels: issue.labels,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    parentRef: issue.parentRef,
    artifactType: issue.artifactType,
    project: { id: `jira-${project.key}`, name: project.name, color: '#2684FF', icon: 'jira' },
    source: 'jira',
  };
}

/** Read and format the open issues of every `tracker: jira` project. */
export async function fetchJiraDashboardIssues(): Promise<Array<Record<string, unknown>>> {
  const projects = await findJiraProjectsAsync();
  const perProject = await Promise.all(projects.map(async ({ key, config }) => {
    try {
      const tracker = createJiraTrackerForProject(key, config);
      const issues = await Effect.runPromise(tracker.listIssues({ includeClosed: false, limit: 100 }));
      return issues.map(issue => formatJiraIssue(issue, { key, name: config.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
      console.warn(`[jira-poll] ${key}: ${message}`);
      return [];
    }
  }));
  return perProject.flat();
}
