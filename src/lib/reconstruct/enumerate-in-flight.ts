/**
 * PAN-1920: source-of-truth enumerator for in-flight issues.
 *
 * In-flight = OPEN GitHub issue ∩ has a `feature/<id-lowercase>` workspace on disk.
 * Reads only git worktrees / the workspaces directory; never the SQLite cache.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectConfig } from '../projects.js';

const execAsync = promisify(exec);

const FEATURE_DIR_RE = /^feature-([a-z0-9-]+)$/;

/**
 * List the issue IDs that are both OPEN on GitHub and have a local
 * `feature/<id-lowercase>` workspace directory.
 */
export async function enumerateInFlightIssuesFromSources(
  projects: ProjectConfig[],
  openIssueIds: Set<string>,
): Promise<Set<string>> {
  const inFlight = new Set<string>();
  const seen = new Set<string>();

  for (const project of projects) {
    const workspaceConfig = project.workspace || {};
    const workspacesDir = join(project.path, workspaceConfig.workspaces_dir || 'workspaces');

    // Primary source: scan the workspaces directory for feature-* folders.
    // This works for monorepos and polyrepos alike.
    try {
      const entries = await readdir(workspacesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const match = FEATURE_DIR_RE.exec(entry.name);
        if (!match) continue;
        const issueId = match[1]!.toUpperCase();
        if (seen.has(issueId)) continue;
        seen.add(issueId);
        if (openIssueIds.has(issueId)) {
          inFlight.add(issueId);
        }
      }
    } catch {
      // workspaces directory may not exist for this project
    }

    // Secondary source: git worktree list (useful when the workspace directory
    // is a git worktree but lives outside the configured workspaces_dir).
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: project.path,
        timeout: 10_000,
      });
      for (const line of stdout.split('\n')) {
        const worktreeMatch = /^worktree\s+(.+)$/.exec(line);
        if (!worktreeMatch) continue;
        const worktreePath = worktreeMatch[1]!;
        const baseName = worktreePath.split('/').pop() ?? worktreePath;
        const dirMatch = FEATURE_DIR_RE.exec(baseName);
        if (!dirMatch) continue;
        const issueId = dirMatch[1]!.toUpperCase();
        if (seen.has(issueId)) continue;
        seen.add(issueId);
        if (openIssueIds.has(issueId)) {
          inFlight.add(issueId);
        }
      }
    } catch {
      // project root may not be a git repo, or git is unavailable
    }
  }

  return inFlight;
}
