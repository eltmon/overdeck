/**
 * Project tracker-config doctor check (PAN-4264).
 *
 * A project whose projects.yaml entry gives no way to resolve its tracker (no
 * `tracker`, `rally_project`, `github_repo`, `issue_prefix` or `gitlab_repo`)
 * is skipped by every pipeline-membership refresh. Doctor names those
 * projects so the operator can fix the entry. It computes the predicate from
 * projects.yaml directly, so it does not depend on a running dashboard.
 */
import { tryResolveProjectTrackerType } from '../../lib/pipeline-membership-gather.js';
import { listProjectsSync, type ProjectConfig } from '../../lib/projects.js';

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export function checkProjectTrackerConfig(
  listProjects: () => Array<{ key: string; config: ProjectConfig }> = listProjectsSync,
): CheckResult {
  const unresolved = listProjects()
    .filter(({ config }) => tryResolveProjectTrackerType(config) === null)
    .map(({ key, config }) => config.name ?? key);
  if (unresolved.length === 0) {
    return { name: 'Project Tracker Config', status: 'ok', message: 'Every project resolves a tracker' };
  }
  return {
    name: 'Project Tracker Config',
    status: 'warn',
    message: `No tracker configured for ${unresolved.join(', ')}; pipeline membership skips ${unresolved.length === 1 ? 'it' : 'them'}`,
    fix: 'Set tracker: (or issue_prefix: / github_repo:) for each named project in ~/.overdeck/projects.yaml',
  };
}
