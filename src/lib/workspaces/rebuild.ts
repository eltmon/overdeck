/**
 * Boot-time reconstruction for the workspaces/projects runtime tables (PAN-1990).
 *
 * seedProjectsFromYaml() upserts every projects.yaml entry as a projects row
 * (D-8: boot seeding lives in the dashboard boot path, not every CLI call).
 * backfillIssueWorkspaces() scans each project's workspace directory for
 * existing `feature-*` worktrees and creates a kind='issue' row for any that
 * don't already have one — the same 'zero-loss' guarantee resource-discovery
 * relies on today via directory scraping.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listProjectsSync } from '../projects.js';
import { getWorkspaceForIssue, listProjects } from './resolver.js';
import { createWorkspace, upsertProjectFromConfig } from './writer.js';

const FEATURE_DIR_PATTERN = /^feature-([a-z]+-\d+)$/i;

/** Upsert every projects.yaml entry into the projects table. Idempotent. */
export function seedProjectsFromYaml(): void {
  for (const { key, config } of listProjectsSync()) {
    upsertProjectFromConfig(key, config);
  }
}

/**
 * Create a kind='issue' workspace row for every `feature-*` worktree directory
 * that doesn't already have one. Never removes or modifies existing rows.
 */
export async function backfillIssueWorkspaces(): Promise<void> {
  for (const project of listProjects()) {
    const projectConfig = listProjectsSync().find(({ key }) => key === project.id)?.config;
    const workspacesDirName = projectConfig?.workspace?.workspaces_dir || 'workspaces';
    const workspacesDir = join(project.primaryPath, workspacesDirName);

    const entries = await readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(FEATURE_DIR_PATTERN);
      if (!match) continue;

      const issueId = match[1].toUpperCase();
      if (getWorkspaceForIssue(issueId)) continue;

      await createWorkspace({
        projectId: project.id,
        kind: 'issue',
        name: entry.name,
        path: join(workspacesDir, entry.name),
        branchName: `feature/${match[1].toLowerCase()}`,
        issueId,
      });
    }
  }
}
