/**
 * Boot-time reconstruction for the workspaces/projects runtime tables (PAN-1990).
 *
 * seedProjectsFromYaml() upserts every projects.yaml entry as a projects row
 * (D-8: boot seeding lives in the dashboard boot path, not every CLI call).
 * backfillIssueWorkspaces() scans each project's workspace directory for
 * existing `feature-*` worktrees and creates a kind='issue' row for any that
 * don't already have one — the same 'zero-loss' guarantee resource-discovery
 * relies on today via directory scraping.
 * rebuildMainAndScratchWorkspaces() scans each project's memory home
 * (~/.overdeck/memory/{projectId}/{workspaceId}/metadata.json, the identity
 * mirror written by writer.createWorkspace/archiveWorkspace) and recreates
 * any main/scratch row missing from the DB, preserving the original id.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkspaceIdentity, resolveWorkspaceIdentityPath } from '../memory/identity-record.js';
import { resolveMemoryRoot } from '../memory/paths.js';
import { listProjectsSync } from '../projects.js';
import { getWorkspaceById, getWorkspaceForIssue, listProjects } from './resolver.js';
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

export interface RebuildMainAndScratchWorkspacesOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

export interface RebuildMainAndScratchWorkspacesResult {
  scanned: number;
  created: number;
  skipped: number;
  createdIds: string[];
}

/**
 * Recreate any main/scratch workspace row missing from the DB from its
 * fixture identity mirror (metadata.json under the workspace's memory home).
 * Issue-kind rows are backfillIssueWorkspaces()'s job — this only covers
 * main/scratch, which have no worktree-directory naming convention to scan.
 * Never removes or modifies existing rows. --dry-run performs zero writes.
 */
export async function rebuildMainAndScratchWorkspaces(
  options: RebuildMainAndScratchWorkspacesOptions = {},
): Promise<RebuildMainAndScratchWorkspacesResult> {
  const result: RebuildMainAndScratchWorkspacesResult = { scanned: 0, created: 0, skipped: 0, createdIds: [] };

  for (const project of listProjects()) {
    const memoryRoot = resolveMemoryRoot(project.id);
    const entries = await readdir(memoryRoot, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceId = entry.name;
      result.scanned += 1;

      if (getWorkspaceById(workspaceId)) {
        result.skipped += 1;
        continue;
      }

      const record = await readWorkspaceIdentity(resolveWorkspaceIdentityPath(project.id, workspaceId));
      if (!record || (record.kind !== 'main' && record.kind !== 'scratch')) {
        result.skipped += 1;
        continue;
      }

      if (options.verbose) {
        console.log(`[rebuild-workspaces] ${options.dryRun ? 'would create' : 'creating'} ${record.kind} workspace ${record.id} (${record.name}) for project ${project.id}`);
      }

      if (!options.dryRun) {
        await createWorkspace({
          id: record.id,
          projectId: record.projectId,
          kind: record.kind,
          name: record.name,
          path: record.path,
          branchName: record.branchName,
          parentBranch: record.parentBranch,
          issueId: record.issueId,
          createdAt: record.createdAt,
        });
      }
      result.created += 1;
      result.createdIds.push(record.id);
    }
  }

  return result;
}
