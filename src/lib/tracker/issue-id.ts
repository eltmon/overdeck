import type { Issue, TrackerType } from './interface.js';

/**
 * The `${issuePrefix}-<n>` id for one tracker issue.
 *
 * GitHub's `ref` is a bare `#<number>` (no team/prefix concept at the
 * tracker layer — Overdeck's own `issue_prefix` convention, e.g.
 * `PAN-<n>` == `eltmon/overdeck#<n>`, is layered on top), so it is combined
 * with `issuePrefix` here. Linear/GitLab/Rally already return a prefixed
 * identifier (e.g. `MIN-902`) as `ref`.
 */
export function issueIdFromTrackerIssue(issue: Issue, trackerType: TrackerType, issuePrefix: string): string {
  if (trackerType === 'github') {
    return `${issuePrefix.toUpperCase()}-${issue.ref.replace(/^#/, '')}`;
  }
  return issue.ref.toUpperCase();
}
