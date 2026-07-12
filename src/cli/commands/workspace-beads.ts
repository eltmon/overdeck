import { exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { findProjectByPathSync, type ProjectConfig } from '../../lib/projects.js';
import { ensureStateWorktree, resolveStateHome } from '../../lib/state-home.js';
import { runMutationBatch } from '../../lib/beads/writer.js';
import { resolveCanonicalBeadsHome } from '../../lib/beads/home.js';

const execAsync = promisify(exec);
const REDIRECT_MANAGED_BEADS_VERSION = 1 * 10000 + 0 * 100 + 4;

function encodeBeadsVersion(version: string): number {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 0;
  const [, major, minor, patch] = match.map(Number);
  return major * 10000 + minor * 100 + patch;
}

/**
 * Check beads version to determine which approach to use
 * Returns version as a sortable semver number (e.g., v1.0.4 = 10004) or 0 if not installed
 */
async function getBeadsVersion(): Promise<number> {
  try {
    const { stdout } = await execAsync('bd --version', { encoding: 'utf-8' });
    return encodeBeadsVersion(stdout);
  } catch {}
  return 0;
}

export async function ensureWorkspaceBeadsRedirect(
  workspacePath: string,
  project: ProjectConfig | null = findProjectByPathSync(workspacePath),
): Promise<string> {
  let expectedTarget = '../../.beads';
  if (project) {
    const stateHome = await resolveStateHome(project);
    if (stateHome.migrated) {
      const status = await ensureStateWorktree(project);
      if (status.status === 'dirty' || status.status === 'error' || status.status === 'legacy') {
        throw new Error(`Cannot repair workspace beads redirect: state worktree ${status.status}`);
      }
      expectedTarget = resolveCanonicalBeadsHome(workspacePath, project) ?? join(stateHome.worktreePath, '.beads');
    }
  }

  const beadsDir = join(workspacePath, '.beads');
  const redirectPath = join(beadsDir, 'redirect');
  let current: string | null = null;
  try {
    current = readFileSync(redirectPath, 'utf8').trim();
  } catch {}
  if (current === expectedTarget) return redirectPath;

  mkdirSync(beadsDir, { recursive: true });
  chmodSync(beadsDir, 0o700);
  const tmp = `${redirectPath}.tmp-${process.pid}`;
  writeFileSync(tmp, expectedTarget, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, redirectPath);
  return redirectPath;
}

/**
 * Initialize beads for a workspace
 *
 * Beads v0.47.1+ uses shared database with labels for isolation (recommended)
 * Older versions use separate .beads directories (legacy workaround)
 */
export async function initializeWorkspaceBeads(workspacePath: string, issueId: string): Promise<{ success: boolean; beadId?: string; error?: string }> {
  try {
    const beadsVersion = await getBeadsVersion();

    if (beadsVersion >= REDIRECT_MANAGED_BEADS_VERSION) {
      // v1.0.4+ - Use shared database with issue label for scoping
      // The worktree's .beads/ directory is created from git (only issues.jsonl is committed),
      // so it lacks the redirect file needed to find the main repo's Dolt database.
      // We must create .beads/redirect explicitly — it is gitignored so cannot be inherited.
      await ensureWorkspaceBeadsRedirect(workspacePath);

      // Use bare issueId label (e.g. "pan-419") matching createBeadsFromVBrief and all query sites
      const issueLabel = issueId.toLowerCase();
      const title = `${issueId.toUpperCase()}: Implementation`;

      const batch = await runMutationBatch(
        { project: { workspacePath }, reason: `create implementation bead for ${issueId.toUpperCase()}` },
        (bd) => bd.mutate(['create', '--title', title, '--priority', '1', '--type', 'task', '--labels', issueLabel]),
      );
      if (!batch.ok) return { success: false, error: batch.message };
      const stdout = batch.value;

      // Parse the created bead ID
      const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
      return { success: true, beadId: match?.[1] };
    } else {
      // Legacy approach for older beads versions (< 1.0.4)
      // Remove inherited .beads directory and initialize fresh
      const beadsDir = join(workspacePath, '.beads');
      if (existsSync(beadsDir)) {
        rmSync(beadsDir, { recursive: true, force: true });
      }

      const prefix = 'workspace';
      await execAsync(`bd init --prefix ${prefix}`, { cwd: workspacePath, encoding: 'utf-8' });
      await execAsync('git config beads.role contributor', { cwd: workspacePath }).catch(() => {});
      // Disable beads' auto-export git-add to prevent "git add failed" warnings in worktrees
      await execAsync('bd config set export.git-add false', { cwd: workspacePath, encoding: 'utf-8' }).catch(() => {});

      const title = `${issueId.toUpperCase()}: Implementation`;
      const batch = await runMutationBatch(
        { project: { workspacePath }, reason: `create implementation bead for ${issueId.toUpperCase()}` },
        (bd) => bd.mutate(['create', '--title', title, '--priority', '1', '--type', 'task', '--json']),
      );
      if (!batch.ok) return { success: false, error: batch.message };
      const stdout = batch.value;

      try {
        const result = JSON.parse(stdout);
        return { success: true, beadId: result.id };
      } catch {
        const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
        return { success: true, beadId: match?.[1] };
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export const __testInternals = {
  encodeBeadsVersion,
  REDIRECT_MANAGED_BEADS_VERSION,
};
