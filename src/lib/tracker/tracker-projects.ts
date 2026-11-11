/**
 * Tracker-scoped project lookups (PAN-5152).
 *
 * Finds the registered projects that a tracker poller reads. These lived in
 * `projects.ts`; they moved here so that file stays under its size cap.
 */

import { listProjectsAsync, loadProjectsConfigSync, type ProjectConfig } from '../projects.js';

/**
 * Find all projects that have a rally_project configured.
 * Returns array of { key, config } for projects with Rally project OIDs.
 */
export function findProjectsByRallyProject(): Array<{ key: string; config: ProjectConfig }> {
  const config = loadProjectsConfigSync();
  return Object.entries(config.projects)
    .filter(([, projectConfig]) => !!projectConfig.rally_project)
    .map(([key, projectConfig]) => ({ key, config: projectConfig }));
}

/** Find all projects whose `tracker` is `jira`. */
export async function findJiraProjectsAsync(): Promise<Array<{ key: string; config: ProjectConfig }>> {
  const projects = await listProjectsAsync();
  return projects.filter(({ config }) => config.tracker === 'jira');
}
