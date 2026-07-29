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
 * migrateMemoryHomesToWorkspaces() moves legacy issue-keyed memory homes
 * (memory/{projectId}/{issueId}/, from before this item) onto their
 * workspace UUID and re-points memory_fts.workspace_id by issueId.
 * migrateMemoryHomesToWorkspacesOnce() is the boot-safe wrapper, gated by a
 * marker file so a dashboard restart never re-scans every project's memory
 * home. Wired into the dashboard boot path in main.ts, right after the
 * projects/workspaces boot seeding it depends on. Also reachable directly via
 * `pan admin db rebuild-workspaces`, which runs the unconditional
 * (non-marker-gated) migrateMemoryHomesToWorkspaces().
 */
import { appendFile, mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkspaceIdentity, resolveWorkspaceIdentityPath, writeWorkspaceIdentity } from '../memory/identity-record.js';
import { runMemoryFtsStatement } from '../memory/fts-db.js';
import { ensureParentDir, resolveMemoryBase, resolveMemoryRoot } from '../memory/paths.js';
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

const ISSUE_HOME_DIR_PATTERN = /^[a-z]+-\d+$/i;

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/**
 * Move every entry from `oldPath` into `newPath` (creating `newPath` if
 * needed) except `metadata.json`, which the caller rewrites separately via
 * writeWorkspaceIdentity. Removes `oldPath` once drained. Used instead of a
 * bare directory rename because `newPath` (the workspace's memory home) may
 * already exist — createWorkspace() writes its own metadata.json there at
 * row-creation time, before any migration ever runs, and a session can also
 * have already written observations/pending/summaries/rag-runs under the
 * workspace-uuid path before migration gets a chance to run.
 *
 * A same-named subdirectory at the destination is merged recursively rather
 * than renamed over — a flat `rename` onto an existing non-empty directory
 * fails with ENOTEMPTY. A same-named file at the destination has its legacy
 * content appended rather than silently dropped or overwritten (memory
 * observation/summary files are append-only JSONL/markdown logs, so this
 * preserves both sides).
 */
async function mergeDirectoryEntries(oldPath: string, newPath: string): Promise<void> {
  await mkdir(newPath, { recursive: true });
  const entries = await readdir(oldPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'metadata.json') continue;
    const oldEntryPath = join(oldPath, entry.name);
    const newEntryPath = join(newPath, entry.name);

    if (entry.isDirectory()) {
      await mergeDirectoryEntries(oldEntryPath, newEntryPath);
      continue;
    }

    if (await pathExists(newEntryPath)) {
      const legacyContent = await readFile(oldEntryPath, 'utf8');
      await appendFile(newEntryPath, legacyContent, 'utf8');
      await unlink(oldEntryPath);
      continue;
    }

    await rename(oldEntryPath, newEntryPath);
  }
  await rmdir(oldPath).catch(() => {});
}

export interface MigrateMemoryHomesResult {
  scanned: number;
  migrated: number;
  skippedAlreadyMigrated: number;
  unresolvable: string[];
}

/**
 * Move each project's legacy issue-keyed memory home
 * (memory/{projectId}/{issueId}/) onto its workspace UUID
 * (memory/{projectId}/{workspaceUuid}/) and re-point that project's
 * memory_fts.workspace_id by issueId (PRD D-5 — issueId is the only stable
 * join key available; the legacy directory name IS the issueId, never a
 * stored workspaceId string).
 *
 * Idempotent (NFR-5 / HAZARD H3): skips a directory that already carries a
 * metadata.json identity record (a prior run migrated it, or a crash left
 * one behind before the move completed). Merges entries rather than
 * renaming the whole directory — createWorkspace() already wrote a fresh
 * metadata.json under the workspace-uuid path at row-creation time, so that
 * destination directory typically already exists and a bare `rename` onto it
 * fails with ENOTEMPTY. Never deletes observation files — only moves them.
 * A directory that matches the issue-id naming pattern but has no
 * resolvable issue-workspace row is left in place untouched and reported in
 * `unresolvable`, never removed.
 */
export async function migrateMemoryHomesToWorkspaces(): Promise<MigrateMemoryHomesResult> {
  const result: MigrateMemoryHomesResult = { scanned: 0, migrated: 0, skippedAlreadyMigrated: 0, unresolvable: [] };

  for (const project of listProjects()) {
    const memoryRoot = resolveMemoryRoot(project.id);
    const entries = await readdir(memoryRoot, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory() || !ISSUE_HOME_DIR_PATTERN.test(entry.name)) continue;
      result.scanned += 1;
      const issueId = entry.name;
      const oldPath = join(memoryRoot, issueId);

      const alreadyMigrated = await readWorkspaceIdentity(join(oldPath, 'metadata.json'));
      if (alreadyMigrated) {
        result.skippedAlreadyMigrated += 1;
        continue;
      }

      const workspace = getWorkspaceForIssue(issueId);
      if (!workspace) {
        result.unresolvable.push(`${project.id}/${issueId}`);
        console.warn(`[memory-migration] no workspace row for issue-keyed memory home ${project.id}/${issueId} — left in place`);
        continue;
      }

      const newPath = join(memoryRoot, workspace.id);
      await mergeDirectoryEntries(oldPath, newPath);
      await writeWorkspaceIdentity({
        id: workspace.id,
        projectId: workspace.projectId,
        kind: workspace.kind,
        name: workspace.name,
        path: workspace.path,
        branchName: workspace.branchName,
        parentBranch: workspace.parentBranch,
        issueId: workspace.issueId,
        createdAt: workspace.createdAt,
      });
      await runMemoryFtsStatement(project.id, {
        method: 'run',
        sql: 'UPDATE memory_fts SET workspace_id = ? WHERE issue_id = ?',
        params: [workspace.id, issueId],
      });

      result.migrated += 1;
    }
  }

  return result;
}

/**
 * Boot-safe wrapper: runs migrateMemoryHomesToWorkspaces() at most once,
 * gated by a marker file, so a dashboard restart never re-scans every
 * project's memory home. No-ops (zero directory or FTS changes) once the
 * marker exists.
 */
export async function migrateMemoryHomesToWorkspacesOnce(): Promise<MigrateMemoryHomesResult | null> {
  const markerPath = join(resolveMemoryBase(), '.workspace-keyed');
  const marked = await readFile(markerPath, 'utf8').then(() => true).catch(() => false);
  if (marked) return null;

  const result = await migrateMemoryHomesToWorkspaces();
  await ensureParentDir(markerPath);
  await writeFile(markerPath, `${new Date().toISOString()}\n`, 'utf8').catch(() => {});
  return result;
}
