import { getIssuePrefix, type ProjectConfig } from './projects.js';
import type { TrackerType } from './tracker/interface.js';

/**
 * PAN-4264: the project's tracker, or null when projects.yaml gives no way to
 * resolve one (no `tracker`, `rally_project`, `github_repo`, `issue_prefix` or
 * `gitlab_repo`). Membership refresh skips such projects instead of failing
 * on every refresh.
 */
export function tryResolveProjectTrackerType(project: ProjectConfig): TrackerType | null {
  if (project.tracker) return project.tracker;
  if (project.rally_project) return 'rally';
  if (project.github_repo) return 'github';
  if (getIssuePrefix(project)) return 'linear';
  if (project.gitlab_repo) return 'gitlab';
  return null;
}
